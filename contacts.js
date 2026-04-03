console.log("contacts.js loaded");
function openModalAdd() { 
    document.getElementById('modal-add').classList.remove('hidden'); 
}

function closeModalAdd() { 
    document.getElementById('modal-add').classList.add('hidden'); 
}

function confirmAddContact() {
    const id = document.getElementById('add-id-input').value.trim().toLowerCase();
    if(!id || id === myId) return;
    if(!contacts.find(c => c.id === id)) {
        contacts.push({ id });
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderContacts();
    }
    closeModalAdd();
    document.getElementById('add-id-input').value = "";
}

function renderContacts() {
    const list = document.getElementById('contact-list');
    const empty = document.getElementById('empty-contacts');
    list.innerHTML = "";
    
    if(contacts.length > 0) empty.classList.add('hidden');
    else empty.classList.remove('hidden');

    contacts.forEach(c => {
        if (!c || !c.id) return;
        const row = document.createElement('div');
        row.className = "flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-2xl active:bg-indigo-50 active:scale-[0.98] transition cursor-pointer";
        row.onclick = () => openChat(c.id);
        row.innerHTML = `
            <div class="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center text-indigo-600 font-bold">${(c.id.charAt(0) || '?').toUpperCase()}</div>
            <div class="flex-1">
                <h4 class="font-bold text-gray-800">${c.id}</h4>
                <p class="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">Klik untuk chat</p>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-gray-300"></i>
        `;
        list.appendChild(row);
    });
    lucide.createIcons();
}

function handleInboundConn(conn) {
    activeConn = conn;
    setupConnHandlers(conn);
    if(!contacts.find(c => c.id === conn.peer)) {
        contacts.push({id: conn.peer});
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderContacts();
    }
}

function openProfile() {
    const screen = document.getElementById('screen-profile');
    screen.classList.remove('hidden');
    document.getElementById('profile-name').innerText = myId;
    document.getElementById('profile-avatar-big').innerText = (myId.charAt(0) || '?').toUpperCase();
    setTimeout(() => screen.classList.remove('translate-x-full'), 10);
    lucide.createIcons();
}
