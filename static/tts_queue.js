/**
 * tts_queue.js — Audio Queue Manager cho Bảng Trắng Thông Minh AI
 * ================================================================
 * Thay thế hàm playTTS() cũ trong script.js.
 * 
 * Tính năng:
 * - Gapless playback (không bị khựng giữa câu)
 * - Pre-buffer câu tiếp theo khi đang phát câu hiện tại
 * - LRU cache (tránh re-fetch audio cho text lặp lại)
 * - Fallback tự động sang Web Speech API khi mất kết nối
 * - Tách câu thông minh (không cắt giữa công thức hóa học)
 *
 * Cách tích hợp:
 * 1. Thêm vào index.html: <script src="/tts_queue.js"></script>
 * 2. Xóa hàm playTTS() cũ trong script.js
 * 3. Dùng: window.TTSQueue.speak("H2SO4 là axit mạnh")
 *    hoặc:  playTTS("...") (tương thích ngược)
 */

(function () {
  'use strict';

  // ============================================================
  // 1. SENTENCE CHUNKER (JavaScript)
  // ============================================================
  
  const ChemChunker = {
    /**
     * Tách text thành mảng câu phù hợp cho TTS.
     * Không cắt giữa công thức hóa học.
     */
    chunk(text, maxChars = 180) {
      if (!text || !text.trim()) return [];
      
      // Tách tại dấu kết câu, nhưng không cắt tại số thập phân
      const sentencePattern = /(?<=[.!?;:])\s+(?=[A-ZĐẮẰẲẴẶÂẦẨẪẬĂẮẰẲẴẶAEIOUÁÀẢÃẠ])/gu;
      const rawParts = text.split(sentencePattern).filter(Boolean);
      
      const chunks = [];
      let buffer = '';
      
      for (const part of rawParts) {
        const p = part.trim();
        if (!p) continue;
        if ((buffer + ' ' + p).length < maxChars) {
          buffer = buffer ? buffer + ' ' + p : p;
        } else {
          if (buffer) chunks.push(buffer.trim());
          // Câu dài → tách tại dấu phẩy
          if (p.length > maxChars) {
            const sub = p.split(/,\s+/);
            let subBuf = '';
            for (const s of sub) {
              if ((subBuf + ', ' + s).length < maxChars) {
                subBuf = subBuf ? subBuf + ', ' + s : s;
              } else {
                if (subBuf) chunks.push(subBuf.trim());
                subBuf = s;
              }
            }
            buffer = subBuf;
          } else {
            buffer = p;
          }
        }
      }
      if (buffer.trim()) chunks.push(buffer.trim());
      return chunks;
    },

    /** Ước tính pause (ms) phù hợp sau mỗi chunk */
    pauseAfter(text) {
      if (/tạo thành|cộng với|bay lên|kết tủa|phản ứng/.test(text)) return 600;
      if (/[.!?]$/.test(text)) return 700;
      if (/[;:]$/.test(text)) return 400;
      return 350;
    },
  };


  // ============================================================
  // 2. LRU AUDIO CACHE
  // ============================================================

  class AudioLRUCache {
    constructor(maxSize = 40) {
      this._max = maxSize;
      this._map = new Map(); // key -> ArrayBuffer
    }

    _key(text, voice) {
      return `${voice}|${text}`;
    }

    get(text, voice) {
      const k = this._key(text, voice);
      if (!this._map.has(k)) return null;
      // Move to end (most recently used)
      const val = this._map.get(k);
      this._map.delete(k);
      this._map.set(k, val);
      return val;
    }

    put(text, voice, buffer) {
      const k = this._key(text, voice);
      if (this._map.has(k)) this._map.delete(k);
      if (this._map.size >= this._max) {
        // Delete oldest
        this._map.delete(this._map.keys().next().value);
      }
      this._map.set(k, buffer);
    }

    clear() { this._map.clear(); }
  }


  // ============================================================
  // 3. AUDIO QUEUE MANAGER
  // ============================================================

  class AudioQueueManager {
    constructor(options = {}) {
      this._ttsEndpoint = options.ttsEndpoint || '/api/tts';
      this._voice = options.voice || 'female';
      this._normalize = options.normalize !== false;
      this._fallbackToWebSpeech = options.fallbackToWebSpeech !== false;

      this._queue = [];          // [{text, pauseAfterMs}]
      this._isPlaying = false;
      this._abortController = null;
      this._audioCtx = null;
      this._sourceNode = null;
      this._cache = new AudioLRUCache(40);
      this._prefetchPromise = null;
      this._prefetchText = null;

      // Listeners
      this._onStart = options.onStart || null;     // (text) => void
      this._onEnd = options.onEnd || null;         // () => void
      this._onChunkStart = options.onChunkStart || null; // (text) => void
      this._onError = options.onError || null;     // (err) => void
    }

    // ---- Public API ----

    /**
     * Đọc text (thay thế playTTS cũ).
     * @param {string} text - Văn bản cần đọc
     * @param {Object} opts - { voice: 'female'|'male', context: 'equation'|'quiz'|'general' }
     */
    async speak(text, opts = {}) {
      if (!text || !text.trim()) return;
      this.stop(); // Dừng bất kỳ audio nào đang phát

      const voice = opts.voice || this._voice;
      const context = opts.context || 'general';

      // Tách câu
      const chunks = ChemChunker.chunk(text);
      if (!chunks.length) return;

      // Build queue
      this._queue = chunks.map(c => ({
        text: c,
        pauseAfterMs: ChemChunker.pauseAfter(c),
        voice,
        context,
      }));

      this._isPlaying = true;
      this._abortController = new AbortController();

      if (this._onStart) this._onStart(text);

      await this._playQueue();

      if (this._onEnd) this._onEnd();
    }

    /** Dừng phát và xóa queue */
    stop() {
      if (this._abortController) {
        this._abortController.abort();
        this._abortController = null;
      }
      if (this._sourceNode) {
        try { this._sourceNode.stop(); } catch (_) {}
        this._sourceNode = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      this._queue = [];
      this._isPlaying = false;
      this._prefetchPromise = null;
      this._prefetchText = null;
    }

    get isPlaying() { return this._isPlaying; }

    // ---- Private ----

    async _playQueue() {
      const signal = this._abortController?.signal;

      for (let i = 0; i < this._queue.length; i++) {
        if (signal?.aborted) break;

        const item = this._queue[i];

        // Pre-buffer câu tiếp theo khi đang fetch câu hiện tại
        const nextItem = this._queue[i + 1];
        if (nextItem && this._prefetchText !== nextItem.text) {
          this._prefetchText = nextItem.text;
          this._prefetchPromise = this._fetchAudio(nextItem.text, nextItem.voice, signal);
          // Không await — chạy song song
        }

        if (this._onChunkStart) this._onChunkStart(item.text);

        // Phát chunk hiện tại
        const success = await this._playChunk(item, signal);

        if (signal?.aborted) break;

        // Pause giữa câu
        if (i < this._queue.length - 1 && item.pauseAfterMs > 0) {
          await this._sleep(item.pauseAfterMs, signal);
        }

        if (!success && this._fallbackToWebSpeech) {
          this._webSpeechSpeak(item.text);
          await this._waitForWebSpeech();
        }
      }

      this._isPlaying = false;
    }

    async _playChunk(item, signal) {
      try {
        const audioBuffer = await this._getAudio(item.text, item.voice, signal);
        if (!audioBuffer || signal?.aborted) return false;
        await this._playBuffer(audioBuffer, signal);
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false;
        console.warn('[TTS] Chunk error:', err.message);
        if (this._onError) this._onError(err);
        return false;
      }
    }

    async _getAudio(text, voice, signal) {
      // Check cache
      const cached = this._cache.get(text, voice);
      if (cached) return cached;

      // Check prefetch
      if (this._prefetchText === text && this._prefetchPromise) {
        const buf = await this._prefetchPromise;
        this._prefetchPromise = null;
        return buf;
      }

      return this._fetchAudio(text, voice, signal);
    }

    async _fetchAudio(text, voice, signal) {
      const url = new URL(this._ttsEndpoint, window.location.origin);
      url.searchParams.set('text', text);
      url.searchParams.set('voice', voice || 'female');
      url.searchParams.set('normalize', this._normalize ? '1' : '0');

      const resp = await fetch(url.toString(), { signal });
      if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);

      const arrayBuffer = await resp.arrayBuffer();
      // Decode để kiểm tra hợp lệ và cache
      const ctx = this._getAudioContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      this._cache.put(text, voice, decoded);
      return decoded;
    }

    async _playBuffer(audioBuffer, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('', 'AbortError')); return; }

        const ctx = this._getAudioContext();
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        this._sourceNode = source;

        const onAbort = () => {
          try { source.stop(); } catch (_) {}
          reject(new DOMException('', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        source.onended = () => {
          signal?.removeEventListener('abort', onAbort);
          this._sourceNode = null;
          resolve();
        };
        source.start(0);
      });
    }

    _getAudioContext() {
      if (!this._audioCtx || this._audioCtx.state === 'closed') {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume();
      }
      return this._audioCtx;
    }

    _webSpeechSpeak(text) {
      if (!window.speechSynthesis) return;
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'vi-VN';
      utt.rate = 0.9;
      // Chọn giọng vi-VN nếu có
      const viVoice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('vi'));
      if (viVoice) utt.voice = viVoice;
      window.speechSynthesis.speak(utt);
    }

    _waitForWebSpeech() {
      return new Promise(resolve => {
        if (!window.speechSynthesis?.speaking) { resolve(); return; }
        const check = setInterval(() => {
          if (!window.speechSynthesis.speaking) { clearInterval(check); resolve(); }
        }, 100);
      });
    }

    _sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('', 'AbortError')); }, { once: true });
      });
    }
  }


  // ============================================================
  // 4. GLOBAL SINGLETON + COMPATIBILITY SHIM
  // ============================================================

  /** Singleton instance */
  const TTSQueue = new AudioQueueManager({
    ttsEndpoint: '/api/tts',
    voice: 'female',
    normalize: true,
    fallbackToWebSpeech: true,
    onStart: (text) => {
      // Cập nhật UI (nếu có nút TTS)
      document.querySelectorAll('.tts-active').forEach(el => el.classList.remove('tts-active'));
    },
    onEnd: () => {
      document.querySelectorAll('.tts-active').forEach(el => el.classList.remove('tts-active'));
    },
    onError: (err) => {
      console.warn('[TTSQueue] Error:', err.message);
    }
  });

  /**
   * Tương thích ngược với hàm playTTS() cũ trong script.js.
   * Sau khi thêm file này, hàm playTTS() mới sẽ dùng AudioQueueManager
   * thay vì Web Speech API.
   */
  window.playTTS = function (text, opts) {
    if (!text || !text.trim()) return;
    TTSQueue.speak(text, opts || {});
  };

  /** Stop từ bên ngoài */
  window.stopTTS = function () {
    TTSQueue.stop();
  };

  /** Expose singleton để gọi trực tiếp */
  window.TTSQueue = TTSQueue;


  // ============================================================
  // 5. AUTO-INITIALIZE: Kết nối với nút TTS hiện có
  // ============================================================

  document.addEventListener('DOMContentLoaded', () => {
    // Preload Web Speech voices (cần gọi trước khi dùng)
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
    }

    // Kiểm tra /api/tts endpoint có hoạt động không
    fetch('/api/tts?text=xin+ch%C3%A0o&normalize=0')
      .then(r => {
        if (r.ok) {
          console.log('[TTSQueue] Backend TTS endpoint sẵn sàng ✓');
        } else {
          console.warn(`[TTSQueue] /api/tts trả về ${r.status} — fallback Web Speech`);
        }
      })
      .catch(() => {
        console.warn('[TTSQueue] Không kết nối được /api/tts — sẽ dùng Web Speech API');
      });
  });

  console.log('[TTSQueue] Đã tải. Dùng: window.TTSQueue.speak("text") hoặc playTTS("text")');

})();
