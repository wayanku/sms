let peer, myId, activeConn, activeCall, localStream, db, sb, replyingTo = null;
let contacts = JSON.parse(localStorage.getItem('p2p_contacts') || '[]').filter(c => c && typeof c.id === 'string');
let isMic = true, isCam = true;
let typingTimeout;

const msgSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
const callSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
callSound.loop = false; // Karena suara notifikasi pendek, tidak perlu di-looping panjang

const supabaseUrl = 'https://peljkofgteuqedzfjlhi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlbGprb2ZndGV1cWVkemZqbGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDE0NDcsImV4cCI6MjA4MzYxNzQ0N30.Gzmqx7CEudTjkjIjYuuuJ-tOk0tneWMOMK7j1a9QvpM';

db = new Dexie("ChatProDB");
db.version(4).stores({
    // Menambahkan indeks gabungan untuk performa maksimal ala Chats+
    messages: '++id, peerId, sender, text, type, time, expires_at, replyTo, isRead, ' +
              '[peerId+sender+isRead], [peerId+isRead], [sender+isRead]', 
    calls: '++id, peerId, type, status, time'
});
// Auto Login and initial setup
function initApp() {
    const userIn = document.getElementById('login-username');
    myId = userIn.value.trim().toLowerCase().replace(/\s+/g, '_');
    if (myId.length < 3) return alert("ID terlalu pendek!");

    sb = supabase.createClient(supabaseUrl, supabaseKey);
    localStorage.setItem('p2p_myid', myId);
    setupRealtime();

    peer = new Peer(myId, { debug: 1 });

    peer.on('open', (id) => {
        document.getElementById('screen-login').classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => document.getElementById('screen-login').classList.add('hidden'), 500);
        document.getElementById('screen-home').classList.remove('hidden');
        document.getElementById('profile-name').innerText = id; // Update profile screen
        document.getElementById('profile-avatar-big').innerText = id.charAt(0).toUpperCase(); // Update profile screen
        renderRecentChats();
        renderContacts();
        renderCallHistory();
        startEphemeralCleanup(); // Call it here, after db/sb are initialized and peer is open.
        updateTotalUnreadBadge();
        showToast("Terhubung sebagai " + id);
        if (Notification.permission !== 'granted') Notification.requestPermission();
    });

    peer.on('connection', handleInboundConn);
    peer.on('call', handleInboundCall);

    peer.on('error', (err) => { 
        if(err.type === 'unavailable-id') alert("ID sudah ada yang pakai!");
        else showToast("Koneksi gagal");
    });

    peer.on('disconnected', () => {
        showToast("Koneksi terputus. Mencoba menyambung...");
        peer.reconnect();
    });
}

// Auto Login and initial setup
function startApp() {
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
    sb.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const msg = payload.new;
            if (msg.receiver === myId) {
                // Tambahkan pengirim ke daftar kontak jika belum ada agar muncul di UI
                if (!contacts.find(c => c && c.id === msg.sender)) {
                    contacts.push({ id: msg.sender });
                    localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
                    if (typeof renderRecentChats === 'function') {
                        renderRecentChats();
                        renderContacts();
                    }
                }

                // Simpan dan tampilkan jika tidak ada koneksi P2P aktif dengan pengirim ini
                if (!activeConn || !activeConn.open || activeConn.peer !== msg.sender) {
                    saveMsg(msg.sender, {
                        type: 'text', text: msg.content, time: new Date(msg.created_at).getTime(), 
                        expires_at: msg.expires_at ? new Date(msg.expires_at).getTime() : null
                    }, 'them').then(async () => {
                        if(document.getElementById('target-name').innerText === msg.sender) renderMsgs(msg.sender);
                        else showNotification(msg.sender, msg.content || "Media");
                        await updateTotalUnreadBadge();
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
    if (Notification.permission === 'granted' && document.hidden) {
        new Notification(`Pesan dari ${sender}`, { body: text });
    } else {
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
