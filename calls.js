function handleInboundCall(call) {
    callSound.play().catch(() => {});
    
    window.incomingCall = call;
    const overlay = document.getElementById('incoming-call-overlay');
    document.getElementById('ic-name').innerText = call.peer;
    document.getElementById('ic-avatar').innerText = call.peer.charAt(0).toUpperCase();
    
    overlay.classList.remove('hidden');
    lucide.createIcons();
}

async function acceptCall() {
    const call = window.incomingCall;
    callSound.pause();
    document.getElementById('incoming-call-overlay').classList.add('hidden');
    document.getElementById('call-target-name').innerText = call.peer;
    saveCallLog(call.peer, 'incoming', 'accepted');
    await setupMedia(true);
    call.answer(localStream);
    manageCall(call);
}

function rejectCall() {
    const call = window.incomingCall;
    callSound.pause();
    document.getElementById('incoming-call-overlay').classList.add('hidden');
    saveCallLog(call.peer, 'incoming', 'missed');
    call.close();
}

async function startCall(type) {
    const id = document.getElementById('target-name').innerText;
    document.getElementById('call-target-name').innerText = id;
    saveCallLog(id, 'outgoing', 'calling');
    await setupMedia(type === 'video');
    document.getElementById('screen-call').classList.remove('hidden');
    const call = peer.call(id, localStream);
    manageCall(call);
}

async function setupMedia(video) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: video, audio: true });
        document.getElementById('local-video-pip').srcObject = localStream;
    } catch(e) { showToast("Gagal akses media"); callSound.pause(); }
}

function toggleMic() {
    isMic = !isMic;
    if (localStream && localStream.getAudioTracks().length > 0) {
        localStream.getAudioTracks()[0].enabled = isMic;
    }
    document.getElementById('mic-toggle').innerHTML = `<i data-lucide="${isMic ? 'mic' : 'mic-off'}"></i>`;
    lucide.createIcons();
}

function toggleCam() {
    isCam = !isCam;
    if (localStream && localStream.getVideoTracks().length > 0) {
        localStream.getVideoTracks()[0].enabled = isCam;
    }
    document.getElementById('cam-toggle').innerHTML = `<i data-lucide="${isCam ? 'video' : 'video-off'}"></i>`;
    lucide.createIcons();
}

async function switchCamera() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Toggle facing mode
    const currentFacing = videoTrack.getSettings().facingMode;
    const newFacing = currentFacing === 'user' ? 'environment' : 'user';

    videoTrack.stop();
    
    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: newFacing },
            audio: true
        });
        
        const newVideoTrack = newStream.getVideoTracks()[0];
        localStream.removeTrack(videoTrack);
        localStream.addTrack(newVideoTrack);
        
        document.getElementById('local-video-pip').srcObject = localStream;
        
        if (activeCall && activeCall.peerConnection) {
            const sender = activeCall.peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(newVideoTrack);
        }
    } catch (e) { showToast("Gagal ganti kamera"); }
}

function manageCall(call) {
    activeCall = call;
    document.getElementById('screen-call').classList.remove('hidden');
    call.on('stream', (rem) => { document.getElementById('remote-video').srcObject = rem; });
    call.on('close', endCall);
}

function endCall() {
    callSound.pause();
    if(activeCall) activeCall.close();
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    document.getElementById('screen-call').classList.add('hidden');
}

async function saveCallLog(peerId, type, status) {
    await db.calls.add({ peerId, type, status, time: Date.now() });
    renderCallHistory();
}

async function renderCallHistory() {
    const list = document.getElementById('call-history-list');
    const logs = await db.calls.orderBy('time').reverse().toArray();
    list.innerHTML = logs.length ? "" : '<div class="p-10 text-center opacity-30 text-xs font-bold">Tidak ada riwayat panggilan</div>';
    logs.forEach(log => {
        const item = document.createElement('div');
        item.className = "flex items-center gap-4 py-3 hover:bg-gray-50 border-b border-gray-50 transition last:border-0 px-4";
        item.innerHTML = `
            <div class="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center font-bold text-indigo-600 flex-shrink-0 shadow-sm">${log.peerId.charAt(0).toUpperCase()}</div>
            <div class="flex-1">
                <h4 class="font-bold text-gray-800 text-sm">${log.peerId}</h4>
                <p class="text-[10px] uppercase font-bold text-gray-400">${log.status} • ${new Date(log.time).toLocaleString()}</p>
            </div>`;
        list.appendChild(item);
    });
    lucide.createIcons();
}
