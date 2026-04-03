console.log("contacts.js loaded");
function openModalAdd() { document.getElementById('modal-add').classList.remove('hidden'); }
function closeModalAdd() { document.getElementById('modal-add').classList.add('hidden'); }

function confirmAddContact() {
    const id = document.getElementById('add-id-input').value.trim().toLowerCase();
    if(!id || id === myId) return;
    if(!contacts.find(c => c.id === id)) {
        contacts.push({ id });
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderRecentChats();
        renderContacts();
    }
    closeModalAdd();
    document.getElementById('add-id-input').value = "";
    updateTotalUnreadBadge();
}

async function renderRecentChats(query = "", filter = "all") {
    const list = document.getElementById('contact-list');
    const empty = document.getElementById('empty-contacts');
    list.innerHTML = "";
    
    const validContacts = contacts.filter(c => c && c.id);
    if (validContacts.length > 0) {
        empty.classList.add('hidden');
    } else {
        empty.classList.remove('hidden');
    }

    // Sort contacts by last message time (most recent first)
    const sortedContacts = await Promise.all(validContacts.map(async c => {
        const lastMsg = await db.messages.where('peerId').equals(c.id).last();
        const unreadCount = await db.messages.where({ peerId: c.id, sender: 'them', isRead: 0 }).count(); // Query for isRead: 0
        return { ...c, lastMsg, unreadCount };
    }));

    // Logika Filter Chats+ Style
    let recentChats = sortedContacts.filter(c => c && c.lastMsg);
    
    // Filter berdasarkan Pencarian
    if (query) {
        recentChats = recentChats.filter(c => c.id.toLowerCase().includes(query.toLowerCase()));
    }

    // Filter berdasarkan Kategori (Belum Dibaca)
    if (filter === "unread") {
        recentChats = recentChats.filter(c => c.unreadCount > 0);
    }

    recentChats.sort((a, b) => {
        if (!a || !b) return 0;
        const timeA = a.lastMsg ? a.lastMsg.time : 0;
        const timeB = b.lastMsg ? b.lastMsg.time : 0;
        return timeB - timeA;
    });

    recentChats.forEach(c => {
        if (!c || !c.id) return;
        const row = document.createElement('div');
        row.className = "flex items-center gap-4 py-3 bg-white active:bg-gray-50 transition cursor-pointer border-b border-gray-50 last:border-0 px-4";
        row.onclick = () => openChat(c.id); // Langsung buka chat saat diklik

        const displayName = c.name || c.id; // Gunakan nama alias jika ada
        const lastMsgText = c.lastMsg ? (c.lastMsg.type === 'image' ? '🖼️ Gambar' : c.lastMsg.text) : 'Belum ada pesan';
        const lastTime = c.lastMsg ? new Date(c.lastMsg.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
        const unreadBadge = c.unreadCount > 0 
            ? `<div class="flex flex-col items-end gap-1">
                <span class="text-[10px] text-indigo-600 font-bold">${lastTime}</span>
                <span class="bg-indigo-600 text-white text-[10px] font-bold h-5 min-w-[20px] flex items-center justify-center px-1 rounded-full shadow-sm">${c.unreadCount}</span>
               </div>` 
            : `<span class="text-[10px] text-gray-400 font-bold">${lastTime}</span>`;

        row.innerHTML = `
            <div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-indigo-600 font-bold flex-shrink-0 shadow-sm border border-gray-50">${(c.id.charAt(0) || '?').toUpperCase()}</div>
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-gray-800">${displayName}</h4>
                <p class="text-[13px] text-gray-500 truncate max-w-[150px]">${lastMsgText}</p>
            </div>
            <button onclick="event.stopPropagation(); showContactOptions('${c.id}')" class="p-2 text-gray-400 hover:bg-gray-100 rounded-full flex-shrink-0">
                <i data-lucide="more-vertical" class="w-5 h-5"></i>
            </button>
            ${unreadBadge}
        `;
        list.appendChild(row);
    });
    lucide.createIcons();
}

async function renderContacts(query = "") {
    const list = document.getElementById('all-contacts-list');
    if (!list) return;
    list.innerHTML = "";

    // Urutkan abjad dan filter berdasarkan pencarian
    const sorted = [...contacts]
        .filter(c => c && c.id && (c.id.toLowerCase().includes(query.toLowerCase()) || (c.name && c.name.toLowerCase().includes(query.toLowerCase()))))
        .sort((a, b) => a.id.localeCompare(b.id));

    if (sorted.length === 0) {
        list.innerHTML = `<div class="text-center py-10 opacity-30 text-sm font-bold">${query ? 'Kontak tidak ditemukan' : 'Belum ada kontak'}</div>`;
        return;
    }

    sorted.forEach(c => {
        const row = document.createElement('div');
        row.className = "flex items-center gap-4 py-3 bg-white active:bg-gray-50 transition cursor-pointer border-b border-gray-50 last:border-0 px-4";
        row.onclick = () => openChat(c.id); // Langsung buka chat saat diklik
        const displayName = c.name || c.id; // Gunakan nama alias jika ada
        row.innerHTML = `
            <div class="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold flex-shrink-0">${c.id.charAt(0).toUpperCase()}</div>
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-gray-800">${displayName}</h4>
                <p class="text-[10px] text-gray-400 uppercase font-bold">Ketuk untuk chat</p>
            </div>
            <button onclick="event.stopPropagation(); showContactOptions('${c.id}')" class="p-2 text-gray-300"><i data-lucide="more-vertical" class="w-4 h-4"></i></button>
        `;
        list.appendChild(row);
    });
    lucide.createIcons();
}

function showContactOptions(contactId) {
    const html = `
        <button onclick='handleContactSheetAction("open_chat", "${contactId}")' class="sheet-item text-gray-700">
            <i data-lucide="message-square"></i> Buka Chat
        </button>
        <button onclick='handleContactSheetAction("edit_name", "${contactId}")' class="sheet-item text-gray-700">
            <i data-lucide="edit-3"></i> Ubah Nama
        </button>
        <button onclick='handleContactSheetAction("delete_contact", "${contactId}")' class="sheet-item sheet-item-red">
            <i data-lucide="trash-2"></i> Hapus Kontak
        </button>
    `;
    showBottomSheet(html);
}

function handleContactSheetAction(action, contactId) {
    closeBottomSheet();
    if (action === 'open_chat') {
        openChat(contactId);
    } else if (action === 'edit_name') {
        const current = contacts.find(c => c.id === contactId);
        const newName = prompt("Masukkan nama untuk " + contactId, current.name || "");
        if (newName !== null) {
            contacts = contacts.map(c => c.id === contactId ? { ...c, name: newName.trim() } : c);
            localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
            renderRecentChats();
            renderContacts();
            updateTotalUnreadBadge();
            showToast("Nama diperbarui");
        }
    } else if (action === 'delete_contact') {
        showModalCustom("Hapus Kontak?", `Anda yakin ingin menghapus ${contactId} dari daftar kontak? Semua riwayat chat juga akan terhapus.`, async () => {
            contacts = contacts.filter(c => c.id !== contactId);
            localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
            await db.messages.where('peerId').equals(contactId).delete(); // Hapus semua pesan terkait
            renderContacts();
            showToast(`${contactId} dihapus.`);
            updateTotalUnreadBadge();
            if (document.getElementById('target-name').innerText === contactId) {
                closeChat(); // Tutup chat jika sedang dibuka
            }
        });
    }
}

function handleInboundConn(conn) {
    activeConn = conn;
    setupConnHandlers(conn);
    if(!contacts.find(c => c.id === conn.peer)) {
        contacts.push({id: conn.peer});
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderRecentChats();
        renderContacts();
        updateTotalUnreadBadge();
    }
}

async function updateTotalUnreadBadge() {
    const totalUnread = await db.messages.where({ sender: 'them', isRead: 0 }).count();
    const badge = document.getElementById('unread-total-badge');
    if (badge) {
        if (totalUnread > 0) {
            badge.classList.remove('hidden');
            badge.innerText = totalUnread;
        } else {
            badge.classList.add('hidden');
        }
    }
}
