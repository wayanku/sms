let peer, myId, activeConn, activeCall, localStream, sb, replyingTo = null, messageChannel = null;
window.messageCache = {}; // Cache untuk menyimpan pesan terakhir di memori
window.contacts = JSON.parse(localStorage.getItem('p2p_contacts') || '[]').filter(c => c && typeof c.id === 'string');
window.globalTypingStatus = {}; // Melacak siapa yang sedang mengetik untuk UI Home
let isMic = true, isCam = true;
let transcriberInstance = null;

async function getTranscriber() {
    if (!transcriberInstance) {
        const overlay = document.getElementById('ai-loading-overlay');
        const progressText = document.getElementById('ai-progress-text');
        overlay.classList.remove('hidden');

        // Dynamic Import: Pustaka AI hanya diunduh saat dibutuhkan
        const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
        
        transcriberInstance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
            progress_callback: (p) => {
                if (p.status === 'progress') {
                    progressText.innerText = `Mengunduh model: ${Math.round(p.progress)}%`;
                }
            }
        });
        overlay.classList.add('hidden');
    }
    return transcriberInstance;
}

const msgSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
const callSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
callSound.loop = false; // Karena suara notifikasi pendek, tidak perlu di-looping panjang

// --- E2EE CRYPTO UTILS ---
const cryptoUtils = {
    async getDerivedKey(peerId, ratchetCounter = 0) {
        // ratchetCounter ditambahkan agar kunci berubah setiap kali ada sesi baru (PFS basis)
        const participants = [myId, peerId].sort();
        const sharedSecret = participants.join(':') + (ratchetCounter > 0 ? `:${ratchetCounter}` : '');
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sharedSecret));
        return await crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    },
    async encrypt(text, peerId, ratchetCounter = 0) {
        if (!text) return text;
        const key = await this.getDerivedKey(peerId, ratchetCounter);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined)); // Simpan sebagai Base64
    },
    async decrypt(base64, peerId, ratchetCounter = 0) {
        try {
            if (!base64 || base64.startsWith('data:')) return base64; // Jangan dekripsi jika sudah format media lama
            const key = await this.getDerivedKey(peerId, ratchetCounter);
            const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return new TextDecoder().decode(decrypted);
        } catch (e) { return "[Pesan Terenkripsi]"; }
    }
};

// Helper untuk konversi Audio base64 ke format yang bisa dibaca AI
async function base64ToAudioBuffer(base64) {
    const response = await fetch(base64);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // Whisper butuh mono channel
    let float32Data = audioBuffer.getChannelData(0);
    return float32Data;
}
window.base64ToAudioBuffer = base64ToAudioBuffer;
window.getTranscriber = getTranscriber;

const supabaseUrl = 'https://peljkofgteuqedzfjlhi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlbGprb2ZndGV1cWVkemZqbGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDE0NDcsImV4cCI6MjA4MzYxNzQ0N30.Gzmqx7CEudTjkjIjYuuuJ-tOk0tneWMOMK7j1a9QvpM';

// Inisialisasi DB langsung ke window agar bisa diakses script lain (calls.js, etc)
window.db = new Dexie("ChatProDB");
window.db.version(5).stores({
    // Menambahkan indeks gabungan untuk performa maksimal ala Chats+
    messages: '++id, peerId, sender, text, type, time, expires_at, replyTo, isRead, status, deliveredAt, readAt, fileName, fileType, ' +
              '[peerId+sender+isRead], [peerId+isRead], [sender+isRead], [peerId+time]', 
    calls: '++id, peerId, type, status, time'
});

async function saveMsg(peerId, data, sender) {
    if (data.isViewOnce) {
        if (!window.messageCache[peerId]) window.messageCache[peerId] = [];
        window.messageCache[peerId].push({ ...data, peerId, sender, time: data.time || Date.now() });
        return;
    }

    const msgTime = data.time || Date.now();
    const forcedTTL = 3 * 24 * 60 * 60 * 1000; // 3 hari
    const finalExpiresAt = data.expires_at || (msgTime + forcedTTL);

    if (!window.messageCache[peerId]) window.messageCache[peerId] = [];
    window.messageCache[peerId].push({ ...data, peerId, sender, time: msgTime });
    if (window.messageCache[peerId].length > 100) window.messageCache[peerId].shift();

    try {
        await window.db.messages.add({
            peerId, sender, text: data.text, type: data.type || 'text',
            time: msgTime, expires_at: finalExpiresAt, replyTo: data.replyTo,
            isRead: sender === 'me' ? 1 : 0, status: data.status || 'sent',
            isViewOnce: !!data.isViewOnce, fileName: data.fileName || null,
            fileType: data.fileType || null
        });

        // P2P Priority: Hanya kirim ke Supabase jika P2P tidak aktif
        const currentConn = window.activeConn || activeConn;
        const isP2PActive = currentConn && currentConn.peer === peerId && currentConn.open;

        if (sender === 'me' && sb && !isP2PActive) {
            await sb.from('messages').insert([{
                sender: myId, receiver: peerId, content: data.text,
                created_at: new Date(msgTime).toISOString(),
                expires_at: finalExpiresAt ? new Date(finalExpiresAt).toISOString() : null,
                type: data.type || 'text', fileName: data.fileName || null,
                fileType: data.fileType || null
            }]);
        }
    } catch (e) {
        console.error("Gagal menyimpan pesan:", e);
    }
}

// Auto Login and initial setup
function initApp() {
    const userIn = document.getElementById('login-username');
    const rawId = userIn.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (rawId.length < 3) {
        showToast("ID minimal 3 karakter!");
        return;
    }
    myId = rawId;

    sb = supabase.createClient(supabaseUrl, supabaseKey);
    localStorage.setItem('p2p_myid', myId);

    peer = new Peer(myId, { debug: 1 });
    window.peer = peer; // Sinkronisasi instan agar chat.js bisa membaca 'connect'

    peer.on('open', (id) => {
        document.getElementById('screen-login').classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => document.getElementById('screen-login').classList.add('hidden'), 500);
        document.getElementById('screen-home').classList.remove('hidden');
        document.getElementById('profile-name').innerText = id; // Update profile screen
        document.getElementById('profile-avatar-big').innerText = id.charAt(0).toUpperCase(); // Update profile screen
        
        Promise.all([
            renderRecentChats(),
            renderContacts(),
            renderCallHistory(),
            updateTotalUnreadBadge()
        ]).then(() => {
            setupRealtime();
            startEphemeralCleanup();
        });

        showToast("Terhubung sebagai " + id);
        if (Notification.permission !== 'granted') Notification.requestPermission();
    });

    peer.on('connection', handleInboundConn);
    peer.on('call', handleInboundCall);

    peer.on('error', (err) => { 
        console.error("PeerJS Error:", err.type);
        if(err.type === 'unavailable-id') {
            showToast("ID sudah digunakan, silakan ganti!");
            localStorage.removeItem('p2p_myid');
            setTimeout(() => location.reload(), 2000);
        } else {
            showToast("Masalah jaringan terdeteksi.");
        }
    });

    peer.on('disconnected', () => {
        console.log("Peer terputus, mencoba menyambung ulang...");
        // Gunakan delay agar tidak spamming reconnect
        setTimeout(() => {
            if (peer.disconnected) peer.reconnect();
        }, 3000);
    });
}

// Auto Login and initial setup
function startApp() {
    initTheme();
    const savedId = localStorage.getItem('p2p_myid');
    if(savedId) {
        // Sembunyikan layar login secara instan jika sudah punya ID
        const loginScreen = document.getElementById('screen-login');
        loginScreen.classList.add('hidden');
        // Update profile screen elements directly
        document.getElementById('profile-name').innerText = savedId;
        document.getElementById('profile-avatar-big').innerText = (savedId.charAt(0) || '?').toUpperCase();
        document.getElementById('login-username').value = savedId;
        // Gunakan setTimeout untuk memastikan semua script lain (contacts.js, calls.js, dll.)
        // telah sepenuhnya diurai sebelum initApp() dipanggil.
        setTimeout(initApp, 0); 
    }
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}

document.getElementById('login-username').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') initApp();
});

function setupRealtime() {
    if (!sb) return;
    
    // Hapus channel lama jika ada untuk mencegah error duplikasi subscription
    if (messageChannel) sb.removeChannel(messageChannel);

    messageChannel = sb.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const msg = payload.new;
            if (msg.receiver === myId) {
                // Tambahkan pengirim ke daftar kontak jika belum ada agar muncul di UI
                if (!window.contacts.find(c => c && c.id === msg.sender)) {
                    window.contacts.push({ id: msg.sender });
                    localStorage.setItem('p2p_contacts', JSON.stringify(window.contacts));
                    if (typeof renderRecentChats === 'function') {
                        renderRecentChats();
                        renderContacts();
                    }
                }

                // Gunakan window.activeConn agar sinkron dengan chat.js
                const currentActiveConn = window.activeConn || activeConn;
                if (!currentActiveConn || !currentActiveConn.open || currentActiveConn.peer !== msg.sender) {
                    cryptoUtils.decrypt(msg.content, msg.sender).then(decryptedText => {
                    saveMsg(msg.sender, {
                        type: 'text', 
                        text: msg.content, 
                        time: new Date(msg.created_at).getTime(), 
                        expires_at: msg.expires_at ? new Date(msg.expires_at).getTime() : null,
                        status: 'delivered'
                    }, 'them').then(async () => {
                        // Deteksi apakah chat sedang terbuka secara visual (tidak tertutup animasi slide)
                        const chatScreen = document.getElementById('screen-chat');
                        const isChatOpen = document.getElementById('target-name').innerText === msg.sender && 
                                         !chatScreen.classList.contains('translate-x-full');

                        if(isChatOpen) {
                             renderMsgs(msg.sender);
                             markMessagesAsRead(msg.sender);
                        } else {
                            // Mainkan suara hanya jika chat tidak sedang dibuka
                            msgSound.play().catch(() => {});
                        }
                        
                        renderRecentChats(); // Segarkan daftar chat agar pesan muncul di bawah nama
                        if (!isChatOpen) showNotification(msg.sender, decryptedText || "Media");
                        await updateTotalUnreadBadge();
                    });
                    });
                }
            }
        })
        .subscribe();
}

function showToast(m) {
    const t = document.getElementById('toast');
    t.innerText = m;
    t.classList.replace('opacity-0', 'opacity-100');
    t.classList.replace('translate-y-10', 'translate-y-0');
    setTimeout(() => {
        t.classList.replace('opacity-100', 'opacity-0');
        t.classList.replace('translate-y-0', 'translate-y-10');
    }, 3000);
}

function showNotification(sender, text) {
    const isHomeVisible = !document.getElementById('screen-home').classList.contains('hidden');
    const isChatsTab = !document.getElementById('tab-content-chats').classList.contains('hidden');

    if (Notification.permission === 'granted' && document.hidden) {
        new Notification(`Pesan dari ${sender}`, { body: text });
    } else if (!(isHomeVisible && isChatsTab)) {
        // Hanya tampilkan toast jika user sedang tidak berada di daftar chat
        showToast(`Pesan baru dari ${sender}`);
    }
}

lucide.createIcons();

// Visual viewport resize fix
if ('visualViewport' in window) {
    const handleViewport = () => {
        if (window.innerWidth >= 1024) return; // Jangan jalankan resize otomatis di desktop
        const vv = window.visualViewport;
        const mainApp = document.getElementById('main-app');
        if (mainApp) {
            // Menyesuaikan tinggi aplikasi dengan area yang benar-benar terlihat
            mainApp.style.height = `${vv.height}px`;
            
            // Memaksa posisi ke atas agar tidak ada gap putih saat keyboard muncul di iOS PWA
            if (vv.height < window.innerHeight) window.scrollTo(0, 0);

            // Pastikan chat otomatis scroll ke bawah jika sedang terbuka saat keyboard muncul
            const chatBox = document.getElementById('chat-messages');
            if (chatBox && !document.getElementById('screen-chat').classList.contains('hidden')) {
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }
    };
    window.visualViewport.addEventListener('resize', handleViewport);
    window.visualViewport.addEventListener('scroll', handleViewport);
    window.addEventListener('load', handleViewport);
}

// Expose variables and functions to window for other scripts (chat.js, etc.) and HTML onclicks
Object.assign(window, {
    peer, myId, activeConn, activeCall, localStream, db: window.db, sb, replyingTo, 
    contacts: window.contacts, globalTypingStatus: window.globalTypingStatus,
    messageCache: window.messageCache,
    msgSound, callSound,
    cryptoUtils, getTranscriber, base64ToAudioBuffer,
    initApp, startApp, showToast, saveMsg
});

window.updateVars = () => {
    window.peer = peer; window.myId = myId; window.activeConn = activeConn;
    window.activeCall = activeCall; window.localStream = localStream;
    window.db = window.db; window.sb = sb; window.replyingTo = replyingTo;
    window.contacts = window.contacts;
    window.globalTypingStatus = window.globalTypingStatus;
    window.messageCache = window.messageCache;
    window.msgSound = msgSound; window.callSound = callSound;
};
