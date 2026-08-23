/* ============================================
   Prompt Generator - Unified Storage Wrapper
   Provides versioned, namespaced localStorage access.
   ============================================ */

const STORAGE_VERSION = 'v2';
const STORAGE_PREFIX = 'pg_' + STORAGE_VERSION + '_';

const storage = {
  /**
   * Get a value from localStorage, auto-parsing JSON.
   * Returns null if key doesn't exist or parse fails.
   */
  get(key) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[storage] Failed to get key:', key, e.message);
      return null;
    }
  },

  /**
   * Set a value to localStorage, auto-stringifying JSON.
   */
  set(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('[storage] Failed to set key:', key, e.message);
      if (e.name === 'QuotaExceededError') {
        showToast('⚠️ 存储空间不足，请清理部分数据', 'error');
      }
    }
  },

  /**
   * Remove a key from localStorage.
   */
  remove(key) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (e) {
      console.warn('[storage] Failed to remove key:', key, e.message);
    }
  },

  /**
   * Get a raw string value (non-JSON).
   */
  getRaw(key) {
    return localStorage.getItem(STORAGE_PREFIX + key);
  },

  /**
   * Set a raw string value (non-JSON).
   */
  setRaw(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, value);
    } catch (e) {
      console.warn('[storage] Failed to set raw key:', key, e.message);
    }
  },

  /**
   * Get a boolean value (stored as string 'true'/'false').
   */
  getBool(key) {
    return this.getRaw(key) === 'true';
  },

  /**
   * Set a boolean value.
   */
  setBool(key, value) {
    this.setRaw(key, String(value));
  },

  /**
   * Get all storage keys matching a prefix.
   */
  keys(prefix) {
    const fullPrefix = STORAGE_PREFIX + (prefix || '');
    const result = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(fullPrefix)) {
        result.push(k.slice(STORAGE_PREFIX.length));
      }
    }
    return result;
  }
};