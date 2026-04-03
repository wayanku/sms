function switchTab(tab) {
    const navChats = document.getElementById('nav-chats');
    const navCalls = document.getElementById('nav-calls');
    const contChats = document.getElementById('tab-content-chats');
    const contCalls = document.getElementById('tab-content-calls');

    navChats.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='chats'?'text-indigo-600':'text-gray-400'}`;
    navCalls.className = `flex-1 py-3 flex flex-col items-center gap-1 ${tab==='calls'?'text-indigo-600':'text-gray-400'}`;
    
    contChats.classList.toggle('hidden', tab !== 'chats');
    contCalls.classList.toggle('hidden', tab !== 'calls');
    
    if(tab === 'calls') renderCallHistory();
    lucide.createIcons();
}

function openProfile() {
    const screen = document.getElementById('screen-profile');
    screen.classList.remove('hidden');
    document.getElementById('profile-name').innerText = myId;
    document.getElementById('profile-avatar-big').innerText = (myId.charAt(0) || '?').toUpperCase();
    setTimeout(() => screen.classList.remove('translate-x-full'), 10);
    lucide.createIcons();
}

function closeProfile() {
    const screen = document.getElementById('screen-profile');
    screen.classList.add('translate-x-full');
    setTimeout(() => screen.classList.add('hidden'), 300);
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
