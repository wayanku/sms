// Privacy Shield: Auto Blur saat tab tidak aktif
let typingTimeout;

document.addEventListener('visibilitychange', () => {
    const screenChat = document.getElementById('screen-chat');
    if (document.visibilityState === 'hidden') {
        screenChat.classList.add('privacy-blur');
    } else {
        screenChat.classList.remove('privacy-blur');
    }
});

async function openChat(id) {
    if (!id || id === myId) return;
    const screen = document.getElementById('screen-chat');
    const contact = contacts.find(c => c.id === id);
    const displayName = contact ? (contact.name || contact.id) : id;
    
    screen.classList.remove('hidden');
    setTimeout(() => screen.classList.remove('translate-x-full'), 10);
    
    document.getElementById('target-name').innerText = displayName;
    document.getElementById('target-avatar').innerText = displayName.charAt(0).toUpperCase();

    try {
        // Tandai sebagai dibaca secara lokal dan kirim sinyal ke peer
        await markMessagesAsRead(id);
        await renderMsgs(id);

        if(!activeConn || activeConn.peer !== id) {
            if(activeConn) {
                activeConn.removeAllListeners();
                activeConn.close();
            }
            activeConn = peer.connect(id);
            setupConnHandlers(activeConn);
            if (window.updateVars) window.updateVars(); // Beritahu app.js ada koneksi baru
        }

        // Minta riwayat langsung via P2P jika terhubung, mengurangi beban Supabase
        if (activeConn && activeConn.open) {
            activeConn.send({ type: 'cmd', cmd: 'request_history', lastKnownTime: await getLastMsgTime(id) });
        }

        await syncSupabaseHistory(id);
        lucide.createIcons();
        updateTargetStatus(id, false);
    } catch (error) {
        console.error("Gagal membuka chat:", error);
        showToast("Gagal memuat riwayat pesan");
    }
}

// Helper untuk membuat elemen pesan (refactoring dari renderMsgs agar bisa dipakai ulang)
function createMessageElement(m, peerId) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper relative flex mb-1 ${m.sender === 'me' ? 'justify-end' : 'justify-start'} animate-in fade-in zoom-in-95 duration-300`;
    
    // Logika swipe to reply
    let startX = 0, currentX = 0;
    wrapper.ontouchstart = (e) => { startX = e.touches[0].clientX; wrapper.style.transition = 'none'; };
    wrapper.ontouchmove = (e) => {
        currentX = e.touches[0].clientX - startX;
        if (currentX > 0 && currentX < 100) wrapper.style.transform = `translateX(${currentX}px)`;
    };
    wrapper.ontouchend = () => {
        wrapper.style.transition = 'transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)';
        wrapper.style.transform = 'translateX(0)';
        if(currentX > 70) setReply(m);
        currentX = 0;
    };

    // Double tap for heart reaction
    let lastTap = 0;
    wrapper.onclick = (e) => {
        const now = Date.now();
        if (now - lastTap < 300) {
            handleReaction('❤️', m.time);
        } else {
            // Single tap logic - might delay to wait for double tap
            setTimeout(() => { if(Date.now() - lastTap >= 300) {} }, 300);
        }
        lastTap = now;
    };

    wrapper.oncontextmenu = (e) => {
        e.preventDefault();
        showMessageOptions(m);
    };

    const timeStr = new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const statusIcon = m.status === 'sending' ? 'clock' : (m.status === 'read' || m.status === 'delivered' ? 'check-check' : 'check');
    const statusColor = m.status === 'read' ? 'text-blue-500' : 'text-gray-400';

    // DEKRIPSI KONTEN PESAN (m.text sudah diasumsikan terdekripsi atau teks mentah untuk optimistic UI)
    let displayContent = m.text;
    let viewOnceLabel = "";
    let ephemeralUI = "";

    if(m.expires_at && (m.expires_at - m.time < 2 * 24 * 60 * 60 * 1000)) {
        const diff = Math.max(0, Math.floor((m.expires_at - Date.now()) / 1000));
        const label = diff > 60 ? "24h" : `${diff}s`;
        ephemeralUI = `<div class="absolute -top-3 ${m.sender==='me'?'right-0': 'left-0'} bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-amber-200 z-10">
            <i data-lucide="timer" class="w-2.5 h-2.5"></i>${label}
        </div>`;
    }

    if (m.type === 'audio') {
        const bars = Array.from({length: 15}, () => Math.floor(Math.random() * 15) + 5);
        displayContent = `
            <div class="flex items-center gap-3 py-1 min-w-[210px]">
                <button onclick="playAudioMsg(this, '${displayContent}')" class="w-11 h-11 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all shrink-0">
                    <i data-lucide="play" class="w-5 h-5 ml-0.5 fill-current"></i>
                </button>
                <div class="flex items-center gap-[2px] h-8 flex-1 overflow-hidden">
                    ${bars.map(h => `<div class="audio-bar w-1 bg-indigo-300 rounded-full" style="height: ${h}px"></div>`).join('')}
                </div>
                <button onclick="transcribeAudioMsg('${displayContent}', this)" class="p-1.5 bg-gray-100 text-gray-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                    <i data-lucide="languages" class="w-4 h-4"></i>
                </button>
                <span class="text-[10px] font-black text-gray-400 font-mono">${m.duration || '0:00'}</span>
            </div>`;
    } else if (m.type === 'image') {
        if (m.isViewed && m.isViewOnce) {
            displayContent = `<div class="flex items-center gap-2 text-gray-400 italic text-sm py-2"><i data-lucide="eye-off" class="w-4 h-4"></i> Foto telah dilihat</div>`;
        } else {
            displayContent = `
                <div class="relative group">
                    <img src="${displayContent}" class="rounded-[16px] max-w-full h-auto mb-1 shadow-sm border border-black/5 cursor-pointer hover:brightness-90 transition-all" style="max-height: 300px" onclick="openImagePreview('${displayContent}', ${m.id}, ${m.isViewOnce})">
                    <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <i data-lucide="maximize-2" class="text-white w-6 h-6 drop-shadow-lg"></i>
                    </div>
                </div>`;
            if (m.isViewOnce) {
                viewOnceLabel = `<div class="text-[10px] font-bold text-indigo-400 flex items-center gap-1 mb-1"><i data-lucide="eye" class="w-3 h-3"></i> Sekali Lihat</div>`;
            }
        }
    } else if (m.type === 'file') { // Handle generic files
        displayContent = `
            <div class="flex items-center gap-2 py-1">
                <i data-lucide="file" class="w-5 h-5 text-indigo-600"></i>
                <span class="text-sm font-medium">${m.fileName || 'File'}</span>
                <button onclick="downloadFile('${displayContent}', '${m.fileName || 'file'}', '${m.fileType || ''}')" class="ml-auto p-1 text-indigo-600"><i data-lucide="download" class="w-4 h-4"></i></button>
            </div>`;
    }

    let replyUI = m.replyTo ? `<div class="bg-black/5 p-2 rounded-md border-l-4 border-emerald-500 mb-1 opacity-80 italic text-[11px] overflow-hidden"><div class="font-bold text-emerald-700 not-italic truncate">${m.replyTo.sender}</div><div class="truncate text-gray-600">${m.replyTo.text}</div></div>` : "";
    const reactionUI = m.reactions ? `<div class="absolute -bottom-2.5 ${m.sender==='me'?'right-2': 'left-2'} bg-white shadow border border-gray-100 rounded-full px-1.5 py-0.5 text-[12px] z-10">${m.reactions}</div>` : "";

    wrapper.innerHTML = `
        ${ephemeralUI}
        <div class="relative group max-w-[85%] sm:max-w-[75%] w-fit min-w-[65px]">
            <div class="px-2 py-1.5 shadow-[0_1px_0.5px_rgba(0,0_0,0.13)] text-[15px] leading-tight ${m.sender==='me'?'bg-[#dcf8c6] rounded-lg rounded-tr-none':'bg-white rounded-lg rounded-tl-none border border-black/[0.05]'}">
                ${viewOnceLabel}
                <div class="relative">
                    ${replyUI}
                    <div class="break-words inline text-[#303030]">${displayContent}</div>
                    <div class="flex items-center gap-1 float-right ml-4 mt-1 opacity-60 select-none">
                        <span class="text-[10px] font-medium">${timeStr}</span>
                        ${m.sender==='me' ? `<i data-lucide="${statusIcon}" class="w-[11px] h-[11px] ${statusColor}"></i>` : ''}
                    </div>
                    <div class="clear-both"></div>
                </div>
            </div>
            ${reactionUI}
        </div>
    `;
    return wrapper;
}

// Fungsi baru untuk menyuntikkan pesan langsung ke DOM tanpa refresh database
async function appendSingleMsgToUI(peerId, m) {
    const box = document.getElementById('chat-messages');
    const isAtBottom = box.scrollHeight - box.clientHeight <= box.scrollTop + 100;
    
    let displayContent = m.text;
    if (!m.isUnencrypted && m.sender === 'them' && m.type === 'text') {
        displayContent = await cryptoUtils.decrypt(m.text, peerId);
    } else if (m.type === 'image' || m.type === 'audio' || m.type === 'file') {
        if (m.sender === 'them') {
            displayContent = await cryptoUtils.decrypt(m.text, peerId);
        } else {
            displayContent = m.text;
        }
    }
    
    const wrapper = createMessageElement({ ...m, text: displayContent }, peerId);
    box.appendChild(wrapper);

    if (isAtBottom) {
        box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    }
    lucide.createIcons();

    // Sinkronkan status tombol input
    updateInputButtons();
}

function updateInputButtons() {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    const recordBtn = document.getElementById('record-btn');
    if (!input || !sendBtn || !recordBtn) return;

    const hasText = input.value.trim().length > 0;
    sendBtn.classList.toggle('hidden', !hasText);
    recordBtn.classList.toggle('hidden', hasText);
}

function handleInboundConn(conn) {
    // Daftarkan handler untuk memproses data yang masuk dari siapapun
    setupConnHandlers(conn);

    // Update activeConn hanya jika kita sedang membuka/melihat layar chat orang ini
    const isChatOpen = !document.getElementById('screen-chat').classList.contains('translate-x-full');
    const currentTarget = document.getElementById('target-name').innerText;
    if (isChatOpen && currentTarget === conn.peer) {
        activeConn = conn;
        if (window.updateVars) window.updateVars();
    }

    // Masukkan ke daftar kontak jika pengirim belum dikenal
    if(!contacts.find(c => c && c.id === conn.peer)) {
        contacts.push({id: conn.peer});
        localStorage.setItem('p2p_contacts', JSON.stringify(contacts));
        renderContacts();
    }
    renderRecentChats();
    updateTotalUnreadBadge();
}

function closeChat() {
    const screen = document.getElementById('screen-chat');
    screen.classList.add('translate-x-full');
    setTimeout(() => screen.classList.add('hidden'), 300);
    if (activeConn) sendTypingStatus(false);
}

function setupConnHandlers(conn) {
    conn.on('data', (data) => {
        if(data.type === 'cmd') {
            if(data.cmd === 'clear_chat') db.messages.where('peerId').equals(conn.peer).delete().then(() => renderMsgs(conn.peer));
            if(data.cmd === 'delete_msg') db.messages.where({time: data.time}).delete().then(() => renderMsgs(conn.peer));
            
            // Respon permintaan riwayat via P2P
            if(data.cmd === 'request_history') {
                db.messages.where('peerId').equals(conn.peer)
                  .filter(m => m.time > (data.lastKnownTime || 0))
                  .toArray().then(msgs => {
                      if(msgs.length > 0) conn.send({ type: 'history_data', messages: msgs });
                  });
            }
            
            if(data.cmd === 'read_receipt') {
                const now = Date.now();
                db.messages.where({peerId: conn.peer, sender: 'me', status: 'delivered'})
                   .modify({status: 'read', readAt: now})
                   .then(() => renderMsgs(conn.peer));
            }
            if(data.cmd === 'reaction') {
                db.messages.where({peerId: conn.peer, time: data.time})
                   .modify({reactions: data.reaction})
                   .then(() => renderMsgs(conn.peer));
            }
            return;
        }
        if(data.type === 'ack') {
            const now = Date.now();
            db.messages.where({time: data.time}).modify({status: 'delivered', deliveredAt: now}).then(() => renderMsgs(conn.peer));
            return;
        }

        // Terima data riwayat langsung dari peer
        if(data.type === 'history_data') {
            data.messages.forEach(m => {
                saveMsg(conn.peer, m, m.sender === 'me' ? 'them' : 'me'); // Invert sender logic
            });
            return;
        }
        if (['text', 'image', 'audio'].includes(data.type)) {
            msgSound.play().catch(() => {});

            const isChatOpen = document.getElementById('target-name').innerText === conn.peer && 
                             !document.getElementById('screen-chat').classList.contains('translate-x-full');
            
            // Tampilkan pesan secara instan ke UI jika chat sedang dibuka
            if(isChatOpen) {
                // Untuk pesan masuk, text-nya masih terenkripsi, jadi perlu dekripsi di appendSingleMsgToUI
                // atau kirim data mentah dan biarkan appendSingleMsgToUI yang dekripsi
                appendSingleMsgToUI(conn.peer, { ...data, sender: 'them', isUnencrypted: false });
                markMessagesAsRead(conn.peer);
            }

            saveMsg(conn.peer, data, 'them').then(() => {
                renderRecentChats(); // Update daftar di home screen secara real-time
                updateTotalUnreadBadge();
            });
            conn.send({ type: 'ack', time: data.time });
        } else if (data.type === 'typing') {
            updateTargetStatus(conn.peer, data.isTyping);
            
            const wasTyping = globalTypingStatus[conn.peer];
            globalTypingStatus[conn.peer] = data.isTyping;
            
            // Hanya update jika status berubah untuk mencegah glitch/flicker
            if (wasTyping !== data.isTyping) {
                updateHomeTypingIndicator(conn.peer, data.isTyping);
            }
        }
    });
}

function updateHomeTypingIndicator(peerId, isTyping) {
    const row = document.querySelector(`#contact-list [data-peer-id="${peerId}"]`);
    if (!row) return; // Jika kontak tidak ada di daftar pesan terbaru, abaikan

    const p = row.querySelector('p');
    if (!p) return;

    if (isTyping) {
        // Update secara langsung tanpa re-render seluruh list
        p.innerText = "sedang mengetik...";
        p.className = "text-[13px] text-green-500 font-bold italic animate-pulse";
    } else {
        // Saat berhenti mengetik, kita panggil renderRecentChats sekali 
        // untuk mengembalikan teks pesan terakhir yang benar dari database.
        // Gunakan sedikit delay agar tidak berbenturan dengan sinyal typing terakhir
        clearTimeout(window.typingRefreshTimeout);
        window.typingRefreshTimeout = setTimeout(() => {
            renderRecentChats();
        }, 500);
    }
}

function sendMsg() {
    const input = document.getElementById('chat-input');
    const txt = input.value.trim();
    // Mode ephemeral sementara di-set 'none' karena UI dropdown dilepas untuk estetika
    const mode = 'none';
    if(!txt) return;

    const targetId = document.getElementById('target-name').innerText;
    if (!targetId || targetId === "Nama Teman") return;

    const msgTime = Date.now(); // Pastikan timestamp konsisten
    // Optimistic UI: Tampilkan pesan di layar secara instan (isUnencrypted: true karena belum dienkripsi)
    appendSingleMsgToUI(targetId, { type: 'text', text: txt, sender: 'me', time: msgTime, status: 'sending', isUnencrypted: true });

    // Default: Paksa hapus setelah 3 hari jika mode 'none' dipilih (untuk hemat DB)
    const forcedTTL = 3 * 24 * 60 * 60 * 1000;
    let expiresAt = mode === '10s' ? msgTime + 10000 :
                    (mode === '24h' ? msgTime + 86400000 :
                    msgTime + forcedTTL);

    // Enkripsi teks sebelum dimasukkan ke objek pesan
    cryptoUtils.encrypt(txt, targetId).then(async encryptedTxt => {
    const msgObj = {
            type: 'text', text: encryptedTxt, time: msgTime, expires_at: expiresAt, status: 'sent',
        replyTo: replyingTo ? { text: replyingTo.text, sender: replyingTo.sender } : null
    };
    
    // Coba kirim via P2P jika tersedia
    if(activeConn && activeConn.open && activeConn.peer === targetId) {
        activeConn.send(msgObj);
    } else {
        msgObj.status = 'pending_p2p'; // Menandakan terkirim via Cloud saja
    }

    await saveMsg(targetId, msgObj, 'me'); 
    renderMsgs(targetId); // Refresh UI untuk mengganti ikon jam ke centang
    });

    input.value = "";
    updateInputButtons();
    cancelReply();
}

async function getLastMsgTime(peerId) {
    const last = await db.messages.where('peerId').equals(peerId).last();
    return last ? last.time : 0;
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
                    image_url: msg.image_url || null, // Pertahankan jika masih ada pesan lama yang pakai ini
                    isRead: msg.sender === myId ? 1 : 0, // Set isRead during sync
                    fileName: msg.fileName || null, // Tambahkan fileName
                    fileType: msg.fileType || null  // Tambahkan fileType
                });
            }
        }
    }
}

async function markMessagesAsRead(peerId) {
    if (!peerId) return;
    const updated = await db.messages
        .where({ peerId: peerId, sender: 'them', isRead: 0 })
        .modify({ isRead: 1 });
    
    if (updated > 0 && activeConn && activeConn.peer === peerId && activeConn.open) {
        activeConn.send({ type: 'cmd', cmd: 'read_receipt' });
    }
    
    renderRecentChats();
    updateTotalUnreadBadge();
}

async function deleteMsg(m, mode) {
    const el = document.querySelector(`[data-msg-id="${m.id}"]`);
    if (el) el.classList.add('shredding');
    
    setTimeout(async () => {
        await db.messages.delete(m.id);
        renderMsgs(m.peerId);
    }, 550);

    if(mode === 'everyone' && activeConn && activeConn.open) {
        activeConn.send({ type: 'cmd', cmd: 'delete_msg', time: m.time });
        await sb.from('messages').delete().eq('created_at', new Date(m.time).toISOString());
    }
}

function downloadFile(base64Data, filename, mimeType) {
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = filename;
    if (mimeType) link.type = mimeType;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("File berhasil disimpan");
}

function updateTargetStatus(peerId, isTyping) {
    const statusEl = document.getElementById('target-status');
    if (document.getElementById('target-name').innerText === peerId) {
        if (isTyping) {
            statusEl.innerHTML = `<div class="flex items-center gap-1 text-green-500 font-medium">
                <span>mengetik</span>
                <span class="flex gap-0.5">
                    <span class="w-1 h-1 bg-green-500 rounded-full animate-bounce"></span>
                    <span class="w-1 h-1 bg-green-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                    <span class="w-1 h-1 bg-green-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </span>
            </div>`;
        } else {
            statusEl.innerText = "online";
            statusEl.className = "text-[11px] text-indigo-400 font-bold uppercase tracking-wider";
        }
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
    const emojis = ['❤️', '👍', '😂', '😮', '😢', '🔥'];
    const emojiBar = `<div class="flex justify-between mb-4 bg-gray-50 p-2 rounded-2xl border border-gray-100">
        ${emojis.map(e => `<button onclick="handleReaction('${e}', ${m.time})" class="text-2xl hover:scale-125 transition-transform active:scale-90">${e}</button>`).join('')}
    </div>`;

    const html = `
        ${emojiBar}
        <button onclick='handleSheetAction("reply", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="reply"></i> Balas Pesan
        </button>
        <button onclick='showMsgInfo(${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="info"></i> Info Pesan
        </button>
        ${m.type === 'image' ? `
        <button onclick='handleSheetAction("download_img", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="download"></i> Simpan Gambar
        </button>
        ` : (m.type === 'file' || m.type === 'audio' ? ` 
        <button onclick='handleSheetAction("download_file", ${m.id})' class="sheet-item text-gray-700">
            <i data-lucide="download"></i> Unduh File
        </button>
        ` : '')} 
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

async function showMsgInfo(id) {
    const m = await db.messages.get(id);
    const format = (t) => t ? new Date(t).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : '--:--';
    const html = `
        <div class="p-4 bg-gray-50 rounded-2xl mb-4 border border-black/5">
            <div class="flex justify-between items-center mb-3">
                <span class="text-xs font-bold text-gray-400">TERKIRIM</span>
                <span class="text-sm font-mono text-gray-700">${format(m.time)}</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-xs font-bold text-blue-500">DIBACA</span>
                <span class="text-sm font-mono text-gray-700">${format(m.readAt)}</span>
            </div>
        </div>
    `;
    showBottomSheet(html + `<button onclick="closeBottomSheet()" class="sheet-item w-full justify-center font-bold">Tutup</button>`);
}

async function handleReaction(emoji, msgTime) {
    const peerId = document.getElementById('target-name').innerText;
    await db.messages.where({peerId: peerId, time: msgTime}).modify({reactions: emoji});
    if(activeConn && activeConn.open) {
        activeConn.send({ type: 'cmd', cmd: 'reaction', time: msgTime, reaction: emoji });
    }
    closeBottomSheet();
    renderMsgs(peerId);
}

function handleSheetAction(action, id) {
    const m = window.lastSelectedMsg;
    closeBottomSheet();
    if(action === 'reply') setReply(m);
    if(action === 'download_img') downloadFile(m.text, `ChatsPlus_${m.time}.png`, 'image/png');
    if(action === 'download_file') downloadFile(m.text, m.fileName || `ChatsPlus_${m.time}`, m.fileType);
    if(action === 'delete_me') deleteMsg(m, 'me');
    if(action === 'delete_all') deleteMsg(m, 'everyone');
}

async function renderMsgs(id, searchQuery = "") {
    const box = document.getElementById('chat-messages');
    // Cek apakah user sedang scroll di atas (untuk menjaga posisi scroll)
    const isAtBottom = box.scrollHeight - box.clientHeight <= box.scrollTop + 100;

    let msgs = [];
    
    // Cek Cache Memori dulu sebelum ke Database
    if (messageCache[id] && messageCache[id].length > 0 && !searchQuery) {
        msgs = [...messageCache[id]];
    } else {
        // Jika cache kosong, ambil dari DB dan isi cache
        msgs = await db.messages.where('peerId').equals(id).reverse().limit(50).toArray();
        msgs.reverse();
        if (!searchQuery) messageCache[id] = [...msgs];
    }
    
    if (searchQuery) {
        msgs = msgs.filter(m => m.text && m.text.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    const fragment = document.createDocumentFragment();
    
    let lastDate = null;
    // Gunakan for...of karena kita perlu await untuk dekripsi
    for (const m of msgs) {
        if(m.expires_at && Date.now() > m.expires_at) continue; // ERROR FIX: Gunakan continue, bukan return agar pesan lain tetap muncul
        
        // Date Separator logic
        const msgDate = new Date(m.time).toLocaleDateString();
        if (msgDate !== lastDate) {
            const dateDiv = document.createElement('div');
            dateDiv.className = "flex justify-center my-4";
            dateDiv.innerHTML = `<span class="bg-black/5 text-[10px] px-3 py-1 rounded-full text-gray-500 font-bold uppercase tracking-wider">${msgDate === new Date().toLocaleDateString() ? 'Hari Ini' : msgDate}</span>`;
            fragment.appendChild(dateDiv);
            lastDate = msgDate;
        }
        // Pesan yang diambil dari DB sudah dienkripsi, jadi perlu didekripsi sebelum ditampilkan
        const decryptedText = await cryptoUtils.decrypt(m.text, id);
        const wrapper = createMessageElement({ ...m, text: decryptedText, isUnencrypted: true }, id); // isUnencrypted true karena sudah didekripsi
        fragment.appendChild(wrapper);
    }
    box.replaceChildren(fragment); // Lebih efisien daripada innerHTML = ""
    if (isAtBottom) box.scrollTop = box.scrollHeight;
    lucide.createIcons();
}

// --- VOICE NOTE LOGIC ---
let mediaRecorder;
let audioChunks = [];
let recordStartTime;
let audioContext, analyser, dataArray, animationId;

async function toggleRecording() {
    const btn = document.getElementById('record-btn');
    const visualizer = document.getElementById('voice-visualizer');

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Setup Visualizer
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            analyser.fftSize = 32;
            dataArray = new Uint8Array(analyser.frequencyBinCount);

            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            recordStartTime = Date.now();
            
            mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                const duration = Math.round((Date.now() - recordStartTime) / 1000);
                const reader = new FileReader();
                reader.onloadend = () => sendAudioMsg(reader.result, `${Math.floor(duration/60)}:${(duration%60).toString().padStart(2,'0')}`);
                reader.readAsDataURL(audioBlob);
                stream.getTracks().forEach(t => t.stop());
                cancelAnimationFrame(animationId);
                if(visualizer) visualizer.classList.add('hidden');
            };
            
            mediaRecorder.start();
            btn.classList.add('text-red-500');
            if(visualizer) {
                visualizer.classList.remove('hidden');
                drawLiveWaveform();
            }
            showToast("Merekam...");
        } catch (err) { showToast("Gagal akses mik"); }
    } else {
        mediaRecorder.stop();
        btn.classList.remove('text-red-500', 'animate-pulse');
    }
}

function drawLiveWaveform() {
    analyser.getByteFrequencyData(dataArray);
    const container = document.getElementById('waveform-live-container');
    if(container) {
        container.innerHTML = Array.from(dataArray).slice(0, 12).map(v => 
            `<div class="w-1 bg-red-500 rounded-full transition-all duration-75" style="height: ${Math.max(4, v/4)}px"></div>`
        ).join('');
    }
    animationId = requestAnimationFrame(drawLiveWaveform);
}

async function sendAudioMsg(base64, duration) {
    if (!activeConn || !activeConn.open) return;
    const msgTime = Date.now();
    const encryptedAudio = await cryptoUtils.encrypt(base64, activeConn.peer);
    const msgObj = {
        type: 'audio',
        text: encryptedAudio,
        duration: duration,
        time: msgTime,
        expires_at: msgTime + (3 * 24 * 60 * 60 * 1000),
        status: 'sent'
    };
    activeConn.send(msgObj);
    await saveMsg(activeConn.peer, msgObj, 'me');
    renderMsgs(activeConn.peer); // Refresh UI
}

function playAudioMsg(btn, base64) {
    const icon = btn.querySelector('i');
    const bars = btn.nextElementSibling.querySelectorAll('.audio-bar');
    const audio = new Audio(base64);
    
    audio.ontimeupdate = () => {
        const progress = Math.floor((audio.currentTime / audio.duration) * bars.length);
        bars.forEach((bar, idx) => {
            bar.style.backgroundColor = idx <= progress ? '#4f46e5' : '#d1d5db';
        });
    };
    
    audio.onended = () => {
        bars.forEach(bar => bar.style.backgroundColor = '#d1d5db');
        icon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
    };

    if (audio.paused) {
        audio.play();
        icon.setAttribute('data-lucide', 'pause');
    } else {
        audio.pause();
        icon.setAttribute('data-lucide', 'play');
    }
    lucide.createIcons();
}

// AI Feature: On-Device Transcription
async function transcribeAudioMsg(base64, btn) {
    const overlay = document.getElementById('ai-loading-overlay');
    overlay.classList.remove('hidden');
    btn.disabled = true;

    try {
        const transcriber = await getTranscriber();
        const audioData = await base64ToAudioBuffer(base64);
        const output = await transcriber(audioData);
        
        showModalCustom("Transkrip AI", output.text, () => {
            navigator.clipboard.writeText(output.text);
            showToast("Transkrip disalin!");
        });
    } catch (e) {
        console.error(e);
        showToast("AI gagal memproses suara.");
    } finally {
        overlay.classList.add('hidden');
        btn.disabled = false;
    }
}

async function openImagePreview(base64Data, msgId, isViewOnce) {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-img');
    const downloadBtn = document.getElementById('download-image-btn');

    img.src = base64Data;
    downloadBtn.onclick = () => downloadImage(base64Data, `ChatsPlus_${Date.now()}.png`);

    if (isViewOnce) {
        await db.messages.update(msgId, { isViewed: true });
        // Kita tidak langsung renderMsgs agar user bisa melihat fotonya dulu sampai modal ditutup
        window.pendingViewOnceRefresh = true;
        downloadBtn.classList.add('hidden'); // Larang download untuk view once
    } else {
        downloadBtn.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
    lucide.createIcons();
}

function closeImagePreview() {
    const modal = document.getElementById('image-preview-modal');
    const img = document.getElementById('image-preview-img');
    img.src = ""; // Clear image source
    modal.classList.add('hidden');
    if (window.pendingViewOnceRefresh) {
        renderMsgs(document.getElementById('target-name').innerText);
        window.pendingViewOnceRefresh = false;
    }
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
    if (!file || (file instanceof FileList && file.length === 0)) return;
    if (file instanceof FileList) file = file[0]; // Ambil file pertama jika input berasal dari onchange
    
    // Pilihan: Tanya apakah ingin view once
    const viewOnceConfirm = confirm("Kirim sebagai foto 'Sekali Lihat'?");
    isViewOnce = viewOnceConfirm;

    if (!activeConn || !activeConn.open) {
        showToast("Gagal: Harus terhubung P2P untuk kirim gambar.");
        return;
    }

    showToast("Mengirim gambar...");

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result;

        let msgType = 'file';
        if (file.type.startsWith('image/')) {
            msgType = 'image';
        } else if (file.type.startsWith('audio/')) {
            msgType = 'audio';
        }
        
        const msgTime = Date.now();
        const encryptedContent = await cryptoUtils.encrypt(base64, activeConn.peer);
        
        const msgObj = { 
            type: msgType, 
            text: encryptedContent, 
            fileName: file.name, // Simpan nama file
            fileType: file.type, // Simpan tipe file
            time: msgTime,
            expires_at: msgTime + (3 * 24 * 60 * 60 * 1000),
            isViewOnce: isViewOnce,
            status: 'sent'
        };

        // Optimistic UI: Tampilkan file di layar secara instan (gunakan base64 mentah untuk display)
        appendSingleMsgToUI(activeConn.peer, { ...msgObj, text: base64, sender: 'me', isUnencrypted: true });
        
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
    updateInputButtons();
    sendTypingStatus(true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { sendTypingStatus(false); }, 2000);
});
