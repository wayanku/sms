async function openChat(id) {
    if (!id) return;
    const screen = document.getElementById('screen-chat');
    const contact = contacts.find(c => c.id === id);
    const displayName = contact ? (contact.name || contact.id) : id;
    screen.classList.remove('hidden');
    setTimeout(() => screen.classList.remove('translate-x-full'), 10);
    
    document.getElementById('target-name').innerText = displayName;
    document.getElementById('target-avatar').innerText = displayName.charAt(0).toUpperCase();
    renderMsgs(id);
    markMessagesAsRead(id); // Tandai pesan sebagai sudah dibaca

    if(!activeConn || activeConn.peer !== id) {
        if(activeConn) activeConn.close();
        activeConn = peer.connect(id);
        setupConnHandlers(activeConn);
    }
    await syncSupabaseHistory(id);
    lucide.createIcons();
    updateTargetStatus(id, false); // Set initial status
}

function closeChat() {
    const screen = document.getElementById('screen-chat');
    screen.classList.add('translate-x-full');
    setTimeout(() => screen.classList.add('hidden'), 300);
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

function setupConnHandlers(conn) {
    conn.on('data', (data) => {
        if(data.type === 'cmd') {
            if(data.cmd === 'clear_chat') db.messages.where('peerId').equals(conn.peer).delete().then(() => renderMsgs(conn.peer));
            if(data.cmd === 'delete_msg') db.messages.where({time: data.time}).delete().then(() => renderMsgs(conn.peer));
            return;
        }
        if (data.type === 'text' || data.type === 'image') {
            msgSound.play().catch(() => {});
            saveMsg(conn.peer, data, 'them').then(() => renderMsgs(conn.peer));
            conn.send({ type: 'ack', time: data.time });
        } else if (data.type === 'typing') {
            updateTargetStatus(conn.peer, data.isTyping);
        }
    });
}

function sendMsg() {
    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    const modeEl = document.getElementById('ephemeral-mode');
    const mode = modeEl ? modeEl.value : 'none';
    if(!txt || !activeConn) return;

    // Default: Paksa hapus setelah 3 hari jika mode 'none' dipilih (untuk hemat DB)
    const forcedTTL = 3 * 24 * 60 * 60 * 1000; 
    let expiresAt = mode === '10s' ? Date.now() + 10000 : 
                    (mode === '24h' ? Date.now() + 86400000 : 
                    Date.now() + forcedTTL);

    const msgObj = { 
        type: 'text', text: txt, time: Date.now(), expires_at: expiresAt,
        replyTo: replyingTo ? { text: replyingTo.text, sender: replyingTo.sender } : null
    };
    
    if(activeConn.open) activeConn.send(msgObj);
    saveMsg(activeConn.peer, msgObj, 'me').then(() => renderMsgs(activeConn.peer));
    input.value = "";
    cancelReply();
}

async function saveMsg(peerId, data, sender) {
    const msgTime = data.time || Date.now();
    // Pastikan selalu ada masa berlaku untuk mencegah tumpukan di Supabase
    const forcedTTL = 3 * 24 * 60 * 60 * 1000;
    const finalExpiresAt = data.expires_at || (msgTime + forcedTTL);

    await db.messages.add({
        peerId, 
        sender, 
        text: data.text, 
        type: data.type, 
        time: msgTime, 
        expires_at: finalExpiresAt, 
        replyTo: data.replyTo,
        isRead: sender === 'me' ? 1 : 0 // Pesan kita sendiri otomatis dianggap sudah dibaca (1=true, 0=false)
    });

    // Hanya kirim ke Supabase jika pesan berasal dari kita (mencegah loop)
    if (data.type === 'text' && sender === 'me') {
        await sb.from('messages').insert([{
            sender: sender === 'me' ? myId : peerId,
            receiver: sender === 'me' ? peerId : myId,
            content: data.text,
            created_at: new Date(msgTime).toISOString(),
            expires_at: data.expires_at ? new Date(data.expires_at).toISOString() : null
        }]);
    }
}

async function syncSupabaseHistory(friendId) {
    const { data, error } = await sb
        .from('messages')
        .select('*, created_at')
        .or(`and(sender.eq.${myId},receiver.eq.${friendId}),and(sender.eq.${friendId},receiver.eq.${myId})`)
        .order('created_at', { ascending: true });

    if (data) {
        for (const msg of data) {
            const msgTime = new Date(msg.created_at).getTime();
            const exists = await db.messages.where('time').equals(msgTime).first();
            if (!exists) {
                await db.messages.add({
                    peerId: friendId,
                    sender: msg.sender === myId ? 'me' : 'them',
                    text: msg.content,
                    type: msg.type || 'text', // Ensure type is set
                    status: 'delivered',
                    time: msgTime,
                    image_url: msg.image_url || null,
                    isRead: msg.sender === myId ? 1 : 0 // Set isRead during sync
                });
            }
        }
    }
}

async function markMessagesAsRead(peerId) {
    await db.messages
        .where({ peerId: peerId, sender: 'them', isRead: 0 }) // Query for isRead: 0
        .modify({ isRead: 1 }); // Set to isRead: 1
    
    // Perbarui tampilan daftar kontak untuk menghilangkan badge unread
    renderRecentChats(); // Refresh only recent chats
}

async function deleteMsg(m, mode) {
    await db.messages.delete(m.id);
    if(mode === 'everyone' && activeConn && activeConn.open) {
        activeConn.send({ type: 'cmd', cmd: 'delete_msg', time: m.time });
        await sb.from('messages').delete().eq('created_at', new Date(m.time).toISOString());
    }
    renderMsgs(m.peerId);
}

function updateTargetStatus(peerId, isTyping) {
    const statusEl = document.getElementById('target-status');
    if (document.getElementById('target-name').innerText === peerId) {
        statusEl.innerText = isTyping ? "sedang mengetik..." : "online"; // Chats+ style
        statusEl.classList.toggle('text-indigo-500', !isTyping);
        statusEl.classList.toggle('text-green-500', isTyping);
    }
}

function sendTypingStatus(isTyping) {
    if (activeConn && activeConn.open) {
        activeConn.send({ type: 'typing', isTyping });
    }
}

function setReply(m) {
    replyingTo = { text: m.text || "Media", sender: m.sender === 'me' ? 'Anda' : m.peerId };
    document.getElementById('reply-target-name').innerText = replyingTo.sender;
    document.getElementById('reply-target-text').innerText = replyingTo.text;
    document.getElementById('reply-container').classList.remove('hidden');
    document.getElementById('chat-input').focus();
}

function cancelReply() {
    replyingTo = null;
    document.getElementById('reply-container').classList.add('hidden');
}

function showMessageOptions(m) {
    const html = `
        <button onclick='handleSheetAction("reply", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="reply"></i> Balas Pesan
        </button>
        ${m.type === 'image' ? `
        <button onclick='handleSheetAction("download_img", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="download"></i> Simpan Gambar
        </button>
        ` : ''}
        <button onclick='handleSheetAction("delete_me", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="trash"></i> Hapus untuk Saya
        </button>
        <button onclick='handleSheetAction("delete_all", ${m.id})' class="sheet-item sheet-item-red">
            <i data-lucide="trash-2"></i> Hapus untuk Semua
        </button>
    `;
    showBottomSheet(html);
    // Simpan objek pesan ke window sementara untuk diakses handleSheetAction
    window.lastSelectedMsg = m;
}

function handleSheetAction(action, id) {
    const m = window.lastSelectedMsg;
    closeBottomSheet();
    if(action === 'reply') setReply(m);
    if(action === 'download_img') downloadImage(m.text, `ChatsPlus_${m.time}.png`);
    if(action === 'delete_me') deleteMsg(m, 'me');
    if(action === 'delete_all') deleteMsg(m, 'everyone');
}

function downloadImage(base64Data, filename) {
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Gambar berhasil disimpan");
}

async function renderMsgs(id) {
    const box = document.getElementById('chat-messages');
    const msgs = await db.messages.where('peerId').equals(id).toArray();
    box.innerHTML = "";
    
    msgs.forEach(m => {
        if(m.expires_at && Date.now() > m.expires_at) return;
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper flex ${m.sender === 'me' ? 'justify-end' : 'justify-start'}`;
        
        // Enhanced Swipe to reply logic
        let startX = 0;
        let currentX = 0;
        wrapper.ontouchstart = (e) => {
            startX = e.touches[0].clientX;
            wrapper.style.transition = 'none';
        };
        wrapper.ontouchmove = (e) => {
            currentX = e.touches[0].clientX - startX;
            if (currentX > 0 && currentX < 100) {
                wrapper.style.transform = `translateX(${currentX}px)`;
            }
        };
        wrapper.ontouchend = (e) => {
            wrapper.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
            wrapper.style.transform = 'translateX(0)';
            if(currentX > 70) setReply(m);
            currentX = 0;
        };

        wrapper.onclick = () => showMessageOptions(m);
        wrapper.oncontextmenu = (e) => {
            e.preventDefault();
            showMessageOptions(m);
        };

        let ephemeralUI = "";
        if(m.expires_at && (m.expires_at - m.time < 2 * 24 * 60 * 60 * 1000)) {
            // Hanya tampilkan badge jika masa berlaku < 2 hari (berarti mode ephemeral aktif)
            const diff = Math.max(0, Math.floor((m.expires_at - Date.now()) / 1000));
            const icon = diff > 60 ? "clock" : "timer";
            const label = diff > 60 ? "24 Jam" : `${diff}s`;
            ephemeralUI = `<div class="ephemeral-badge"><i data-lucide="${icon}" class="w-3 h-3"></i> ${label}</div>`;
        }

        let replyUI = m.replyTo ? `<div class="bg-black/5 p-2 rounded-lg border-l-2 border-indigo-400 mb-2 opacity-70 italic text-[11px]"><div class="font-bold text-indigo-600 not-italic">${m.replyTo.sender}</div>${m.replyTo.text}</div>` : "";
        let timeStr = new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        
        let contentHTML = m.text;
        let viewOnceLabel = "";
        if (m.type === 'image') {
            contentHTML = `<img src="${m.text}" class="rounded-lg max-w-full h-auto mb-1 shadow-sm border border-black/5 cursor-pointer" style="max-height: 250px" onclick="openImagePreview('${m.text}', '${m.time}')">`;
            if (m.isViewOnce) {
                viewOnceLabel = `<div class="text-[10px] font-bold text-indigo-300 flex items-center gap-1 mb-1"><i data-lucide="eye" class="w-3 h-3"></i> Sekali Lihat</div>`;
            }
        }
        
        wrapper.innerHTML = `
            <div class="message-bubble shadow-sm ${m.sender==='me'?'bg-indigo-600 text-white bubble-me':'bg-white text-gray-800 bubble-them border border-gray-100'}">
                ${ephemeralUI}${viewOnceLabel}
                ${replyUI}${contentHTML}
                <span class="bubble-time">${timeStr} ${m.sender==='me'?(m.status==='delivered'?'✓✓':'✓'):''}</span>
            </div>`;
        box.appendChild(wrapper);
    });
    box.scrollTop = box.scrollHeight;
    lucide.createIcons();
}

function openImagePreview(base64Data, timestamp) {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-img');
    const downloadBtn = document.getElementById('download-image-btn');

    img.src = base64Data;
    downloadBtn.onclick = () => downloadImage(base64Data, `ChatsPlus_${timestamp}.png`);

    modal.classList.remove('hidden');
    lucide.createIcons();
}

function closeImagePreview() {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-img');
    img.src = ""; // Clear image source
    modal.classList.add('hidden');
}


function clearChatAction(mode) {
    const peerId = document.getElementById('target-name').innerText;
    const title = mode === 'me' ? "Bersihkan Chat?" : "Hapus untuk Semua?";
    showModalCustom(title, "Tindakan ini tidak dapat dibatalkan.", async () => {
        await db.messages.where('peerId').equals(peerId).delete();
        if(mode === 'everyone' && activeConn?.open) {
            activeConn.send({ type: 'cmd', cmd: 'clear_chat' });
            await sb.from('messages').delete().or(`and(sender.eq.${myId},receiver.eq.${peerId}),and(sender.eq.${peerId},receiver.eq.${myId})`);
        }
        renderMsgs(peerId);
        toggleChatMenu();
    });
}

// Ephemeral Worker: Membersihkan pesan yang sudah kedaluwarsa setiap detik
function startEphemeralCleanup() {
    setInterval(async () => {
        const now = Date.now();
        try {
            const expired = await db.messages.where('expires_at').below(now).toArray();
            if(expired.length > 0) {
                for(let m of expired) {
                    await db.messages.delete(m.id);
                    if(m.sender === 'me') {
                        await sb.from('messages').delete().eq('created_at', new Date(m.time).toISOString());
                    }
                }
            }
        } catch (e) { console.error("Cleanup error:", e); }

        const targetId = document.getElementById('target-name').innerText;
        const screenChat = document.getElementById('screen-chat');
        if (targetId && targetId !== "Nama Teman" && !screenChat.classList.contains('hidden')) {
            // Hanya refresh UI jika ada pesan yang akan kadaluarsa dalam waktu dekat (< 1 menit)
            const hasUrgent = await db.messages
                .where('peerId').equals(targetId)
                .and(m => m.expires_at && (m.expires_at - now) < 60000)
                .count();
            if (hasUrgent > 0) renderMsgs(targetId);
        }
    }, 1000);
}

async function sendFile(file, isViewOnce = false) {
    if (!file) return;

    // Jika belum konfirmasi view once, tanya dulu (atau tambahkan toggle di UI)
    if(!isViewOnce && confirm("Kirim sebagai foto Sekali Lihat (1x)?")) isViewOnce = true;

    if (!activeConn || !activeConn.open) {
        showToast("Gagal: Harus terhubung P2P untuk kirim gambar.");
        return;
    }
    // Batasi ukuran gambar (misal 1MB) untuk menjaga kestabilan transmisi data string P2P
    if (file.size > 1024 * 1024) {
        showToast("Ukuran gambar terlalu besar (Maks 1MB)");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;
        const msgObj = { 
            type: 'image', 
            text: base64, // Simpan data base64 di field text
            time: Date.now(),
            expires_at: Date.now() + (3 * 24 * 60 * 60 * 1000) // Default 3 hari
        };
        
        activeConn.send(msgObj);
        await saveMsg(activeConn.peer, msgObj, 'me');
        renderMsgs(activeConn.peer);
        document.getElementById('file-input').value = ""; // Reset input file
    };
    reader.readAsDataURL(file);
}

// Event Listeners
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMsg();
    }
});

document.getElementById('chat-input').addEventListener('input', () => {
    sendTypingStatus(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { sendTypingStatus(false); }, 2000);
});
