#!/usr/bin/env python3
"""
启动 HTTP 服务并打开提示词生成器页面
支持 ComfyUI 代理转发（解决跨域问题）
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import shutil
import subprocess
import threading
import time
import urllib.request
import urllib.error
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, 'data', 'server_config.json')

DEFAULT_CONFIG = {
    "host": "127.0.0.1",
    "port": 8080,
    "html_file": "",
    "comfy_url": "http://127.0.0.1:8188",
    "enable_proxy": True
}

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                for k, v in DEFAULT_CONFIG.items():
                    config.setdefault(k, v)
                return config
        except Exception as e:
            print(f'  [warn] 读取配置失败，使用默认配置: {e}')
            return dict(DEFAULT_CONFIG)
    return dict(DEFAULT_CONFIG)

def save_config(config):
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

def find_html_file(script_dir, preferred=''):
    html_files = [f for f in os.listdir(script_dir) if f.endswith('.html')]
    if not html_files:
        return None
    if preferred and preferred in html_files:
        return preferred
    if len(html_files) == 1:
        return html_files[0]
    # Multiple HTML files: use the most recently modified one
    html_files.sort(key=lambda f: os.path.getmtime(os.path.join(script_dir, f)), reverse=True)
    print(f'  [info] 找到 {len(html_files)} 个 HTML 文件，使用最新的: {html_files[0]}')
    return html_files[0]

# Max request sizes by file type
MAX_BODY_SIZES = {
    'prompts.json': 2 * 1024 * 1024,      # 2MB
    'ai_settings.json': 512 * 1024,        # 512KB
    'comfy_settings.json': 5 * 1024 * 1024, # 5MB (includes workflows)
    'server_config.json': 16 * 1024,        # 16KB
}

def validate_save_data(filename, data):
    """Basic validation of incoming data before writing to disk."""
    if not isinstance(data, (dict, list)):
        raise ValueError('数据必须是 JSON 对象或数组')
    if filename == 'server_config.json':
        if isinstance(data, dict):
            if 'port' in data and not isinstance(data['port'], int):
                raise ValueError('端口必须是整数')
            if 'host' in data and not isinstance(data['host'], str):
                raise ValueError('主机地址必须是字符串')
    return True

class ComfyProxyHandler(http.server.SimpleHTTPRequestHandler):
    comfy_url = "http://127.0.0.1:8188"
    enable_proxy = True
    html_file = ""
    data_dir = None

    # 禁止通过 HTTP 直接访问的敏感路径（含密钥/配置）
    BLOCKED_PATHS = ('/data/', '/__pycache__/', '/api key.txt', '/backup-')

    def log_message(self, format, *args):
        try:
            print(f'  [{self.address_string()}] {args[0]} {args[1] if len(args) > 1 else ""}')
        except Exception:
            pass

    def _is_blocked_path(self):
        p = urllib.parse.unquote(self.path.split('?')[0]).lower()
        return any(p.startswith(b) or p == b.rstrip('/') for b in self.BLOCKED_PATHS)

    def _allowed_origin(self):
        """CORS 来源白名单：只放行「本服务自身」和 localhost/127.0.0.1 的来源。

        之前对所有响应返回 Access-Control-Allow-Origin: *，导致任意网页都能用
        fetch('http://127.0.0.1:8080/api/load-ai') 读到 ai_settings.json 全文
        （含 apiKey）。GET 属 CORS 简单请求、无需预检，所以必须收紧来源。
        """
        origin = self.headers.get('Origin')
        if not origin:
            return None
        try:
            o = urllib.parse.urlparse(origin)
            host = (self.headers.get('Host') or '').split(':')[0]
            if o.hostname in ('127.0.0.1', 'localhost', '::1'):
                return origin
            # 允许「与自己同源」的访问（例如局域网 IP 打开页面时 Origin=Host）
            if host and o.hostname == host:
                return origin
        except Exception:
            pass
        return None

    def _is_foreign_origin(self):
        """请求带了 Origin 但不在白名单内 → 跨站请求，一律拒绝"""
        return 'Origin' in self.headers and self._allowed_origin() is None

    def _reject_foreign(self):
        self.send_response(403)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"error":"Forbidden: cross-site origin"}')

    def _send_cors_origin(self):
        # 幂等：handler 与 end_headers 都会调用，避免同一响应出现两条 ACAO
        if getattr(self, '_cors_sent', False):
            return
        self._cors_sent = True
        origin = self._allowed_origin()
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')

    def do_PROXY(self, method):
        """Handle proxied requests to /comfy-proxy/*"""
        if self._is_foreign_origin():
            self._reject_foreign()
            return
        if not self.enable_proxy:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b'Proxy disabled')
            return

        # Strip /comfy-proxy prefix（注意：path 中已包含查询字符串，无需再拼接）
        path = self.path[len('/comfy-proxy'):]
        if not path.startswith('/'):
            path = '/' + path

        target_url = self.comfy_url.rstrip('/') + path
        print(f'  [proxy] {method} {path} -> {target_url}')

        try:
            data = None
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                data = self.rfile.read(content_length)

            req = urllib.request.Request(
                target_url,
                data=data,
                method=method,
                headers={
                    'Content-Type': self.headers.get('Content-Type', 'application/json'),
                    'Accept': self.headers.get('Accept', '*/*'),
                }
            )

            with urllib.request.urlopen(req, timeout=120) as response:
                self.send_response(response.status)
                # Forward CORS headers（仅白名单来源）
                self._send_cors_origin()
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                cl = response.headers.get('Content-Length')
                if cl:
                    self.send_header('Content-Length', cl)
                self.end_headers()
                # 流式转发，避免大图片一次性读入内存
                shutil.copyfileobj(response, self.wfile)

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._send_cors_origin()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(e.read())
        except urllib.error.URLError as e:
            self.send_response(502)
            self._send_cors_origin()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_msg = json.dumps({"error": f"Cannot connect to ComfyUI: {e.reason}"}).encode()
            self.wfile.write(error_msg)
        except Exception as e:
            self.send_response(500)
            self._send_cors_origin()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_msg = json.dumps({"error": str(e)}).encode()
            self.wfile.write(error_msg)

    def do_GET(self):
        if self._is_foreign_origin():
            self._reject_foreign()
            return
        if self.path.startswith('/comfy-proxy/'):
            self.do_PROXY('GET')
            return
        if self._is_blocked_path():
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":"Forbidden"}')
            return
        if self.path == '/api/load-prompts':
            self._handle_load_file('prompts.json')
            return
        if self.path == '/api/load-ai':
            self._handle_load_file('ai_settings.json')
            return
        if self.path == '/api/load-comfy':
            self._handle_load_file('comfy_settings.json')
            return
        if self.path == '/api/load-server-config':
            self._handle_load_config()
            return
        # enrich_data is now merged into prompts.json response

        if self.path == '/' or self.path == '/index.html':
            self.send_response(302)
            self.send_header('Location', '/' + self.html_file)
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        if self._is_foreign_origin():
            self._reject_foreign()
            return
        if self.path.startswith('/comfy-proxy/'):
            self.do_PROXY('POST')
            return
        if self.path == '/api/save-prompts':
            self._handle_save_file('prompts.json')
            return
        if self.path == '/api/save-ai':
            self._handle_save_file('ai_settings.json')
            return
        if self.path == '/api/save-comfy':
            self._handle_save_file('comfy_settings.json')
            return
        if self.path == '/api/save-server-config':
            self._handle_save_config()
            return
        if self.path == '/api/shutdown':
            self._handle_shutdown()
            return
        self.send_response(404)
        self.end_headers()

    def _handle_load_config(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._send_cors_origin()
        self.end_headers()
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
                return
            except Exception as e:
                print(f'  [warn] 读取 server_config.json 失败: {e}')
        self.wfile.write(b'{}')

    def _handle_save_config(self):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            if content_len > MAX_BODY_SIZES['server_config.json']:
                self.send_response(413)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_origin()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "请求体过大"}).encode())
                return
            body = self.rfile.read(content_len) if content_len > 0 else b'{}'
            data = json.loads(body.decode('utf-8'))
            validate_save_data('server_config.json', data)
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                f.write(body.decode('utf-8'))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except (json.JSONDecodeError, ValueError) as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _handle_shutdown(self):
        """Handle shutdown request: read seconds from body, trigger Windows shutdown"""
        # 安全：仅允许本机请求触发关机（防止 host 设为 0.0.0.0 时被局域网误触）
        client_ip = self.client_address[0] if self.client_address else ''
        if client_ip not in ('127.0.0.1', '::1', 'localhost'):
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": "仅本机可触发关机"}).encode())
            return
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_len)) if content_len > 0 else {}
            seconds = int(body.get('seconds', 60))
            if seconds < 0: seconds = 0
            if seconds > 3600: seconds = 3600
            # Trigger shutdown in a separate thread so we can respond first
            def _do_shutdown():
                subprocess.run(['shutdown', '/s', '/t', str(seconds)], shell=False)
            threading.Thread(target=_do_shutdown, daemon=True).start()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "seconds": seconds}).encode())
            print(f'  [shutdown] 将在 {seconds} 秒后关机')
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _handle_load_file(self, filename):
        data_file = os.path.join(self.data_dir, filename) if self.data_dir else None
        # 文件不存在 → 404。前端据此清空对应类别的本地缓存（文件即真相），
        # 避免「文件已删/改名，但浏览器 localStorage 里的旧数据仍然复活」
        if not data_file or not os.path.exists(data_file):
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"{filename} not found"}).encode())
            return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._send_cors_origin()
        self.end_headers()
        try:
            with open(data_file, 'r', encoding='utf-8') as f:
                content = json.load(f)
            # Ensure prompts.json is always wrapped with pg_prompts_data key
            if filename == 'prompts.json':
                if isinstance(content, dict) and 'data' in content:
                    # New format: {"data":[...], "identity_en":{...}, "cn_en_map":{...}, "enrich_data":{...}}
                    result = {'pg_prompts_data': content['data']}
                    if 'identity_en' in content: result['identity_en'] = content['identity_en']
                    if 'cn_en_map' in content: result['cn_en_map'] = content['cn_en_map']
                    if 'enrich_data' in content: result['enrich_data'] = content['enrich_data']
                    content = result
                elif not isinstance(content, dict):
                    content = {'pg_prompts_data': content}
            # Merge cn_en_map and identity_en into prompts.json response (from user data or fallback)
            if filename == 'prompts.json' and isinstance(content, dict):
                # Build cn_en_map from pg_prompts_data if not present
                if 'cn_en_map' not in content and 'pg_prompts_data' in content:
                    cmap = {}
                    for cat in content['pg_prompts_data']:
                        for item in cat.get('items', []):
                            if 'cn' in item and 'en' in item:
                                cmap[item['cn']] = item['en']
                    if cmap:
                        content['cn_en_map'] = cmap
            self.wfile.write(json.dumps(content, ensure_ascii=False).encode('utf-8'))
            return
        except Exception as e:
            print(f'  [warn] 读取 {filename} 失败: {e}')
        self.wfile.write(b'{}')


    def _handle_save_file(self, filename):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            max_size = MAX_BODY_SIZES.get(filename, 1024 * 1024)
            if content_len > max_size:
                self.send_response(413)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_origin()
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"请求体过大，最大 {max_size // 1024}KB"}).encode())
                return
            body = self.rfile.read(content_len) if content_len > 0 else b'{}'
            data = json.loads(body)
            validate_save_data(filename, data)
            data_file = os.path.join(self.data_dir, filename) if self.data_dir else None
            if data_file:
                os.makedirs(os.path.dirname(data_file), exist_ok=True)
                with open(data_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except json.JSONDecodeError as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"JSON 解析错误: {str(e)}"}).encode())
        except ValueError as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_origin()
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        if self.path.startswith('/comfy-proxy/'):
            if self._is_foreign_origin():
                self._reject_foreign()
                return
            self.send_response(200)
            self._send_cors_origin()
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.end_headers()
            return
        super().do_OPTIONS()

    def end_headers(self):
        # CORS 仅放行白名单来源（见 _allowed_origin），不再使用通配符 *
        if not self.path.startswith('/comfy-proxy/'):
            self._send_cors_origin()
        super().end_headers()


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """多线程 HTTP 服务器：避免代理转发/轮询时阻塞页面其他请求"""
    daemon_threads = True
    allow_reuse_address = True


def main():
    config = load_config()
    
    # Parse command line args
    i = 1
    while i < len(sys.argv):
        if sys.argv[i] == '--port' and i + 1 < len(sys.argv):
            config['port'] = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == '--host' and i + 1 < len(sys.argv):
            config['host'] = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--file' and i + 1 < len(sys.argv):
            config['html_file'] = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--comfy-url' and i + 1 < len(sys.argv):
            config['comfy_url'] = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--no-proxy':
            config['enable_proxy'] = False
            i += 1
        else:
            i += 1
    
    save_config(config)
    
    host = config['host']
    port = config['port']
    
    # Use script directory for all data paths so it works from any cwd
    script_dir = SCRIPT_DIR
    os.chdir(script_dir)
    
    # Find HTML file
    html_file = config.get('html_file', '')
    if not html_file or not os.path.exists(html_file):
        html_file = find_html_file(script_dir, html_file)
        if html_file:
            config['html_file'] = html_file
            save_config(config)
        else:
            print('❌ No HTML files found in current directory')
            sys.exit(1)
    
    if not os.path.exists(html_file):
        print(f'❌ HTML file not found: {html_file}')
        sys.exit(1)
    
    # Configure the handler class
    ComfyProxyHandler.comfy_url = config['comfy_url']
    ComfyProxyHandler.enable_proxy = config.get('enable_proxy', True)
    ComfyProxyHandler.html_file = html_file
    ComfyProxyHandler.data_dir = os.path.join(SCRIPT_DIR, 'data')
    
    try:
        server = ThreadingHTTPServer((host, port), ComfyProxyHandler)
    except OSError as e:
        if '10048' in str(e) or 'Address already in use' in str(e):
            print(f'⚠️  端口 {port} 已被占用')
            while True:
                try:
                    inp = input(f'   请输入新端口 (直接回车使用 {port+1}): ').strip()
                    if not inp:
                        port = port + 1
                    else:
                        port = int(inp)
                    config['port'] = port
                    save_config(config)
                    server = ThreadingHTTPServer((host, port), ComfyProxyHandler)
                    break
                except ValueError:
                    print('   请输入有效的数字端口')
                except OSError:
                    print(f'   端口 {port} 也被占用，请重试')
        else:
            print(f'❌ 启动失败: {e}')
            sys.exit(1)
    
    url = f'http://{host}:{port}/{html_file}'
    proxy_url = f'http://{host}:{port}/comfy-proxy'
    
    print('=' * 60)
    print('  Prompt Generator Server')
    print('  ' + '=' * 50)
    print(f'  Page:     {url}')
    print(f'  Dir:      {script_dir}')
    print(f'  HTML:     {html_file}')
    print()
    if ComfyProxyHandler.enable_proxy:
        print(f'  ComfyUI proxy: {proxy_url}')
        print(f'  Backend:       {config["comfy_url"]}')
        print()
    print('  Set ComfyUI URL to the proxy address above')
    print('  to avoid CORS issues.')
    print()
    print('  Press Ctrl+C to stop')
    print('=' * 60)
    
    def open_browser():
        time.sleep(1.5)
        webbrowser.open(url)
    
    threading.Thread(target=open_browser, daemon=True).start()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.server_close()

if __name__ == '__main__':
    main()
