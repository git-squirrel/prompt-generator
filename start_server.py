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
import threading
import time
import urllib.request
import urllib.error

CONFIG_FILE = os.path.join(os.getcwd(), 'data', 'server_config.json')

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
        except:
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

DATA_DIR = None  # Will be set in main()

class ComfyProxyHandler(http.server.SimpleHTTPRequestHandler):
    comfy_url = "http://127.0.0.1:8188"
    enable_proxy = True
    html_file = ""
    data_dir = None

    def log_message(self, format, *args):
        print(f'  [{self.address_string()}] {args[0]} {args[1]}')

    def do_PROXY(self, method):
        """Handle proxied requests to /comfy-proxy/*"""
        if not self.enable_proxy:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b'Proxy disabled')
            return

        # Strip /comfy-proxy prefix
        path = self.path[len('/comfy-proxy'):]
        if not path.startswith('/'):
            path = '/' + path

        target_url = self.comfy_url.rstrip('/') + path
        print(f'  [proxy] {method} {path} -> {target_url}')

        # Forward query string
        if self.path.find('?') > 0 and path.find('?') < 0:
            qs = self.path[self.path.find('?'):]
            target_url += qs

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

            with urllib.request.urlopen(req, timeout=60) as response:
                self.send_response(response.status)
                # Forward CORS headers
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                self.end_headers()
                self.wfile.write(response.read())

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(e.read())
        except urllib.error.URLError as e:
            self.send_response(502)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_msg = json.dumps({"error": f"Cannot connect to ComfyUI: {e.reason}"}).encode()
            self.wfile.write(error_msg)
        except Exception as e:
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_msg = json.dumps({"error": str(e)}).encode()
            self.wfile.write(error_msg)

    def do_GET(self):
        if self.path.startswith('/comfy-proxy/'):
            self.do_PROXY('GET')
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
        self.send_response(404)
        self.end_headers()

    def _handle_load_config(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
                return
            except:
                pass
        self.wfile.write(b'{}')

    def _handle_save_config(self):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len) if content_len > 0 else b'{}'
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                f.write(body.decode('utf-8'))
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def _handle_load_file(self, filename):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        data_file = os.path.join(self.data_dir, filename) if self.data_dir else None
        # For prompts.json: auto-seed from default_prompts.json on first use
        if filename == 'prompts.json' and data_file:
            if not os.path.exists(data_file) or os.path.getsize(data_file) < 10:
                default_path = os.path.join(self.data_dir, 'default_prompts.json')
                if os.path.exists(default_path):
                    try:
                        with open(default_path, 'r', encoding='utf-8') as f:
                            default_data = json.load(f)
                        os.makedirs(os.path.dirname(data_file), exist_ok=True)
                        with open(data_file, 'w', encoding='utf-8') as f:
                            json.dump(default_data, f, ensure_ascii=False)
                        result = {'nsfw_prompts_data': default_data}
                        self._merge_aux_data(result)
                        self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
                        return
                    except Exception as e:
                        print(f'  [error] Seed prompts.json failed: {e}')
        # Regular file handling
        if data_file and os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                # Ensure prompts.json is always wrapped with nsfw_prompts_data key
                if filename == 'prompts.json' and not isinstance(content, dict):
                    content = {'nsfw_prompts_data': content}
                # Merge cn_en_map and identity_en into prompts.json response
                if filename == 'prompts.json' and isinstance(content, dict):
                    self._merge_aux_data(content)
                self.wfile.write(json.dumps(content, ensure_ascii=False).encode('utf-8'))
                return
            except:
                pass
        self.wfile.write(b'{}')

    def _merge_aux_data(self, result):
        """Merge cn_en_map.json, identity_en.json, and enrich_data.json into the given result dict.
        
        For enrich_data: prefers the enrich_data already embedded in prompts.json (result),
        falls back to reading enrich_data.json from disk if not present.
        """
        if self.data_dir:
            cn_en_path = os.path.join(self.data_dir, 'cn_en_map.json')
            if os.path.exists(cn_en_path):
                try:
                    with open(cn_en_path, 'r', encoding='utf-8') as f:
                        result['cn_en_map'] = json.load(f)
                except Exception as e:
                    print(f'  [error] Reading cn_en_map.json: {e}')
            identity_en_path = os.path.join(self.data_dir, 'identity_en.json')
            if os.path.exists(identity_en_path):
                try:
                    with open(identity_en_path, 'r', encoding='utf-8') as f:
                        result['identity_en'] = json.load(f)
                except Exception as e:
                    print(f'  [error] Reading identity_en.json: {e}')
            # Merge enrich_data: use what's already in prompts.json if present,
            # otherwise fall back to enrich_data.json
            if 'enrich_data' not in result or not result['enrich_data']:
                enrich_path = os.path.join(self.data_dir, 'enrich_data.json')
                if os.path.exists(enrich_path):
                    try:
                        with open(enrich_path, 'r', encoding='utf-8') as f:
                            result['enrich_data'] = json.load(f)
                    except Exception as e:
                        print(f'  [error] Reading enrich_data.json: {e}')

    def _handle_load_json_file(self, filename):
        """Serve a static JSON file from data_dir directly, or return {} if missing."""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        data_file = os.path.join(self.data_dir, filename) if self.data_dir else None
        if data_file and os.path.exists(data_file):
            try:
                with open(data_file, 'r', encoding='utf-8') as f:
                    content = json.load(f)
                self.wfile.write(json.dumps(content, ensure_ascii=False).encode('utf-8'))
                return
            except Exception as e:
                print(f'  [error] Reading {filename}: {e}')
        self.wfile.write(b'{}')

    def _handle_save_file(self, filename):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len) if content_len > 0 else b'{}'
            data = json.loads(body)
            data_file = os.path.join(self.data_dir, filename) if self.data_dir else None
            if data_file:
                os.makedirs(os.path.dirname(data_file), exist_ok=True)
                with open(data_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        if self.path.startswith('/comfy-proxy/'):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.end_headers()
            return
        super().do_OPTIONS()

    def end_headers(self):
        # Add CORS headers to all responses
        if not self.path.startswith('/comfy-proxy/'):
            self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


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
    
    # Use current working directory for all data paths
    script_dir = os.getcwd()
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
    ComfyProxyHandler.data_dir = os.path.join(os.getcwd(), 'data')
    
    try:
        server = socketserver.TCPServer((host, port), ComfyProxyHandler)
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
                    server = socketserver.TCPServer((host, port), ComfyProxyHandler)
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
