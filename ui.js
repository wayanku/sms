function switchTab(tab) {
    const navChats = document.getElementById('nav-chats');
    const navContacts = document.getElementById('nav-contacts');
    const navCalls = document.getElementById('nav-calls');
    const navSettings = document.getElementById('nav-settings');
    const contChats = document.getElementById('tab-content-chats');
    const contContacts = document.getElementById('tab-content-contacts');
    const contCalls = document.getElementById('tab-content-calls');
    const contSettings = document.getElementById('tab-content-settings');

    navChats.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='chats'?'text-indigo-600':'text-gray-400'}`;
    navContacts.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='contacts'?'text-indigo-600':'text-gray-400'}`;
    navCalls.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='calls'?'text-indigo-600':'text-gray-400'}`;
    navSettings.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='settings'?'text-indigo-600':'text-gray-400'}`;
    
    contChats.classList.toggle('hidden', tab !== 'chats');
    contContacts.classList.toggle('hidden', tab !== 'contacts');
    contCalls.classList.toggle('hidden', tab !== 'calls');
    contSettings.classList.toggle('hidden', tab !== 'settings');

    // Update Header
    const header = document.getElementById('main-header');
    const headerTitle = document.getElementById('header-title');
    if (tab === 'settings') {
        headerTitle.innerText = "Pengaturan";
        header.querySelector('.flex.gap-1').classList.add('hidden');
    } else {
        headerTitle.innerText = "Chats+";
        header.querySelector('.flex.gap-1').classList.remove('hidden');
    }

    // Di desktop, pastikan screen-home tetap terlihat meski tab berpindah
    if(window.innerWidth >= 1024) {
        document.getElementById('screen-home').classList.remove('hidden');
    }
    
    if(tab === 'chats') renderRecentChats();
    if(tab === 'contacts') renderContacts();
    if(tab === 'calls') renderCallHistory();
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

function logout() {
    showModalCustom("Keluar Sesi?", "Anda akan kembali ke layar login.", () => {
        localStorage.removeItem('p2p_myid'); location.reload();
    });
}
