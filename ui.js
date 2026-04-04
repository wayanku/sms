function switchTab(tab) {
    const navChats = document.getElementById('nav-chats');
    const navContacts = document.getElementById('nav-contacts');
    const navCalls = document.getElementById('nav-calls');
    const navSettings = document.getElementById('nav-settings');
    const contChats = document.getElementById('tab-content-chats');
    const contContacts = document.getElementById('tab-content-contacts');
    const contCalls = document.getElementById('tab-content-calls');
    const contSettings = document.getElementById('tab-content-settings');

    // Haptic Feedback for Apple-like premium feel
    const canVibrate = window.navigator && window.navigator.vibrate;
    if (canVibrate) window.navigator.vibrate(8);

    const baseNavClass = "flex-1 py-2 flex flex-col items-center gap-1 transition-all duration-300 active:scale-90";
    navChats.className = `${baseNavClass} ${tab==='chats'?'text-indigo-600':'text-slate-400'}`;
    navContacts.className = `${baseNavClass} ${tab==='contacts'?'text-indigo-600':'text-slate-400'}`;
    navCalls.className = `${baseNavClass} ${tab==='calls'?'text-indigo-600':'text-slate-400'}`;
    navSettings.className = `${baseNavClass} ${tab==='settings'?'text-indigo-600':'text-slate-400'}`;

    contChats.classList.toggle('hidden', tab !== 'chats');
    contContacts.classList.toggle('hidden', tab !== 'contacts');
    contCalls.classList.toggle('hidden', tab !== 'calls');
    contSettings.classList.toggle('hidden', tab !== 'settings');

    const header = document.getElementById('main-header');
    const headerTitle = document.getElementById('header-title');
    if(header) {
        header.className = "sticky top-0 z-40 bg-white/70 backdrop-blur-2xl border-b border-black/5 px-6 py-4 flex items-center justify-between shadow-sm";
    }

    // Tambahkan Wallpaper ke area chat jika belum ada
    const chatBox = document.getElementById('chat-messages');
    if (chatBox && !chatBox.querySelector('.chat-wallpaper')) {
        const wp = document.createElement('div');
        wp.className = "chat-wallpaper fixed inset-0 -z-10 opacity-[0.03] pointer-events-none";
        // Menggunakan pola doodle yang lebih mirip WhatsApp
        wp.style.backgroundImage = "url('https://www.transparenttextures.com/patterns/pinstriped-suit.png')";
        wp.style.backgroundColor = "#e5ddd5"; // Warna dasar krem WA
        chatBox.appendChild(wp);
    }

    const headerActions = header ? header.querySelector('div.flex') : null;

    const titles = {
        'chats': 'Chat+',
        'contacts': 'Kontak',
        'calls': 'Panggilan',
        'settings': 'Setelan'
    };

    headerTitle.innerText = titles[tab] || "Pesan";

    const isChat = tab === 'chats';
    if (headerActions) headerActions.classList.toggle('hidden', !isChat);

    // Di desktop, pastikan screen-home tetap terlihat meski tab berpindah
    if(window.innerWidth >= 1024) {
        document.getElementById('screen-home').classList.remove('hidden');
    }
    
    if(tab === 'chats') renderRecentChats();
    if(tab === 'contacts') renderContacts();
    if(tab === 'calls') renderCallHistory();
    
    // Smooth Scroll to Top on Tab Change
    const container = document.getElementById(`tab-content-${tab}`);
    if(container) container.scrollTo({ top: 0, behavior: 'smooth' });

    updateTotalUnreadBadge(); // Update total unread count when switching tabs
    lucide.createIcons();
}

function updateFilter(element, filterType) {
    // Reset semua tombol di dalam container filter
    const pills = document.querySelectorAll('#filter-pills button');
    pills.forEach(p => {
        p.classList.remove('pill-active');
        p.classList.add('pill-inactive');
    });

    // Aktifkan tombol yang diklik
    element.classList.remove('pill-inactive');
    element.classList.add('pill-active');

    renderRecentChats(document.getElementById('search-chat-input').value, filterType);
}

// CUSTOM DIALOG HELPERS
function showModalCustom(title, desc, onConfirm) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerText = desc;
    const modal = document.getElementById('modal-custom');
    modal.classList.remove('hidden');
    setTimeout(() => modal.firstElementChild.classList.add('modal-active'), 10);
    
    document.getElementById('modal-confirm-btn').onclick = () => {
        onConfirm();
        closeModalCustom();
    };
}

function closeModalCustom() {
    const modal = document.getElementById('modal-custom');
    modal.firstElementChild.classList.remove('modal-active');
    setTimeout(() => modal.classList.add('hidden'), 200);
}

function openModalAdd() {
    const modal = document.getElementById('modal-add');
    if (modal) modal.classList.remove('hidden');
}

function closeModalAdd() {
    const modal = document.getElementById('modal-add');
    if (modal) modal.classList.add('hidden');
}

function showBottomSheet(html) {
    document.getElementById('sheet-content').innerHTML = html;
    document.getElementById('bottom-sheet-overlay').classList.remove('hidden');
    document.getElementById('bottom-sheet').classList.add('bottom-sheet-active');
    lucide.createIcons();
}

function closeBottomSheet() {
    document.getElementById('bottom-sheet').classList.remove('bottom-sheet-active');
    setTimeout(() => document.getElementById('bottom-sheet-overlay').classList.add('hidden'), 300);
}

function toggleChatMenu() { 
    document.getElementById('chat-options-menu').classList.toggle('hidden'); 
}

function clearAllLocalHistory() {
    showModalCustom("Hapus Cache?", "Semua riwayat chat akan dihapus dari HP ini.", async () => {
        await db.messages.clear(); await db.calls.clear();
        showToast("Data dibersihkan");
    });
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'system';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
}

function toggleDarkMode() {
    const isDark = document.documentElement.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
    showToast(isDark ? "Mode Terang Aktif" : "Mode Gelap Aktif");
}

function logout() {
    showModalCustom("Keluar Sesi?", "Anda akan kembali ke layar login.", () => {
        localStorage.removeItem('p2p_myid'); location.reload();
    });
}
