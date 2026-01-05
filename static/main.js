
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

const enableBtn = document.getElementById('enable-btn');
const callBtn = document.getElementById('call-btn');
const statusDiv = document.getElementById('status');
const replyDiv = document.getElementById('reply');
const replyText = document.getElementById('reply-text');

let swRegistration = null;
let isSubscribed = false;

// Check Service Worker Support
if ('serviceWorker' in navigator && 'PushManager' in window) {
    console.log('Service Worker and Push is supported');
    navigator.serviceWorker.register('/sw.js')
        .then(function (swReg) {
            console.log('Service Worker is registered', swReg);
            swRegistration = swReg;
            initializeUI();
        })
        .catch(function (error) {
            console.error('Service Worker Error', error);
            statusDiv.textContent = 'SW Error: ' + error.message;
        });
} else {
    console.warn('Push messaging is not supported');
    enableBtn.textContent = 'Push Not Supported';
    enableBtn.disabled = true;
}

function initializeUI() {
    // Check if already subscribed
    swRegistration.pushManager.getSubscription()
        .then(function (subscription) {
            isSubscribed = !(subscription === null);
            updateBtn();
        });

    enableBtn.addEventListener('click', function () {
        enableBtn.disabled = true;
        if (isSubscribed) {
            // Already subscribed
            updateBtn();
        } else {
            subscribeUser();
        }
    });

    // Note: callBtn now uses mousedown/mouseup events for tap-vs-hold detection
    // defined later in the file
}

function updateBtn() {
    if (isSubscribed) {
        enableBtn.textContent = 'Notifications Enabled ✅';
        enableBtn.disabled = true;
    } else {
        enableBtn.textContent = 'Enable Notifications';
        enableBtn.disabled = false;
    }
}

function subscribeUser() {
    const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
    })
        .then(function (subscription) {
            console.log('User is subscribed.');
            return sendSubscriptionToBackEnd(subscription);
        })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('Bad status code from server.');
            }
            return response.json();
        })
        .then(function (responseData) {
            if (responseData.status === 'success') {
                isSubscribed = true;
                updateBtn();
                statusDiv.textContent = "Subscribed successfully!";
            }
        })
        .catch(function (err) {
            console.log('Failed to subscribe the user: ', err);
            updateBtn(); // Re-enable if failed
            if (Notification.permission === 'denied') {
                enableBtn.textContent = 'Permission Denied';
                statusDiv.textContent = 'You blocked notifications. Please enable them in browser settings.';
            } else {
                enableBtn.disabled = false;
                statusDiv.textContent = 'Failed to subscribe: ' + err.message;
            }
        });
}

function sendSubscriptionToBackEnd(subscription) {
    return fetch('/api/subscribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
    });
}

// --- Visual State Constants ---
const circle = document.querySelector('.progress-ring__circle');
const radius = circle.r.baseVal.value;
const circumference = radius * 2 * Math.PI;
const indicators = [
    document.getElementById('ind-0'),
    document.getElementById('ind-1'),
    document.getElementById('ind-2'),
    document.getElementById('ind-3')
];

circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = circumference;

function setProgress(percent) {
    const offset = circumference - (percent / 100 * circumference);
    circle.style.strokeDashoffset = offset;
}

// --- Audio Context for Synthetic Ring ---
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    return audioCtx;
}

function playOneRing() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const duration = 1.5;
    const frequencies = [523.25, 783.99, 1046.50, 1569.75];
    const gains = [0.3, 0.2, 0.1, 0.05];

    frequencies.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = i % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(gains[i], now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration);
    });
}

let ringingInterval = null;
let ringingTimeout = null;

function stopRinging() {
    console.log("DEBUG: Stopping ring.");
    if (ringingInterval) clearInterval(ringingInterval);
    if (ringingTimeout) clearTimeout(ringingTimeout);
    ringingInterval = null;
    ringingTimeout = null;

    callBtn.classList.remove('ringing');
    indicators.forEach(ind => ind.classList.remove('active', 'recording'));
}

function startVisualRinging() {
    stopRinging(); // Ensure any previous ring is stopped

    callBtn.classList.add('ringing');
    indicators.forEach(ind => ind.classList.add('active'));
    playOneRing();
    ringingInterval = setInterval(playOneRing, 800);

    // Fallback safety timeout
    ringingTimeout = setTimeout(() => {
        stopRinging();
    }, 10000); // 10s fallback
}

function triggerCall() {
    callBtn.disabled = true;
    startVisualRinging();
    statusDiv.textContent = 'Sending call...';

    fetch('/api/call', {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            console.log("Call result:", data);
            statusDiv.textContent = 'Call Sent! Waiting for reply...';

            // Stop ringing once sent successfully (or after a small delay to feel good)
            setTimeout(stopRinging, 500);

            // Start polling for reply
            startPolling();

            // Reset button interaction after 5s
            setTimeout(() => {
                callBtn.disabled = false;
            }, 5000);
        })
        .catch(err => {
            statusDiv.textContent = 'Error sending call: ' + err.message;
            callBtn.disabled = false;
            stopRinging();
        });
}

let lastProcessedTimestamp = 0;
let pollInterval;

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    replyDiv.classList.remove('hidden');
    replyText.textContent = "Waiting for reply...";

    let attempts = 0;
    console.log("DEBUG: Starting poll for reply...");
    pollInterval = setInterval(() => {
        attempts++;
        if (attempts > 300) {
            console.log("DEBUG: Polling timed out.");
            clearInterval(pollInterval);
            statusDiv.textContent = "Timed out waiting for reply.";
            return;
        }

        fetch('/api/poll_reply')
            .then(r => r.json())
            .then(data => {
                // Deduplicate using timestamp from backend
                if (data.message && data.timestamp !== lastProcessedTimestamp) {
                    console.log("DEBUG: New reply message received:", data.message, "at", data.timestamp);
                    lastProcessedTimestamp = data.timestamp;
                    clearInterval(pollInterval);
                    handleReply(data.message);
                }
            })
            .catch(e => console.error("DEBUG: Poll error:", e));
    }, 2000);
}

function handleReply(message) {
    console.log("DEBUG: Handling reply:", message);
    stopRinging(); // Stop any active ringing state
    statusDiv.textContent = "Reply Received!";
    replyDiv.classList.remove('hidden');
    replyDiv.style.borderColor = "#ffaa00";
    replyDiv.style.boxShadow = "0 0 20px rgba(255,170,0,0.3)";
    replyText.textContent = message;

    // Pulse effect
    replyDiv.animate([
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(1.05)', opacity: 0.8 },
        { transform: 'scale(1)', opacity: 1 }
    ], { duration: 500, iterations: 2 });

    // Check for audio files
    const audioMap = {
        "1 minutes": "/static/audio/1min.mp3",
        "5 minutes": "/static/audio/5min.mp3",
        "10 minutes": "/static/audio/10min.mp3"
    };

    let audioPlayed = false;
    for (const [key, file] of Object.entries(audioMap)) {
        if (message.includes(key)) {
            console.log(`Playing audio: ${file}`);
            const audio = new Audio(file);
            audio.play().catch(e => console.error("Audio play failed:", e));
            audioPlayed = true;
            break;
        }
    }

    // Speak it as fallback or if no audio match
    if (!audioPlayed && 'speechSynthesis' in window) {
        const msg = new SpeechSynthesisUtterance(message);
        window.speechSynthesis.speak(msg);
    }
}

// --- Combined Button Logic: Tap to Ring, Hold to Record ---

let mediaRecorder;
let audioChunks = [];
let holdTimer = null;
let progressInterval = null;
let isRecording = false;
let hasSentThisPress = false;
const HOLD_THRESHOLD_MS = 1200; // Updated to match progress ring feel

// Mouse events
callBtn.addEventListener('mousedown', handlePressStart);
callBtn.addEventListener('mouseup', handlePressEnd);
callBtn.addEventListener('mouseleave', (e) => {
    if (holdTimer || isRecording) handlePressEnd();
});

// Touch events for mobile
callBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handlePressStart(); });
callBtn.addEventListener('touchend', (e) => { e.preventDefault(); handlePressEnd(); });
callBtn.addEventListener('touchcancel', handlePressEnd);

function handlePressStart() {
    if (callBtn.disabled) return;
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    hasSentThisPress = false;
    callBtn.classList.add('pressed');
    const startTime = Date.now();

    progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / HOLD_THRESHOLD_MS) * 100, 100);
        setProgress(progress);

        if (progress >= 25) indicators[0].classList.add('active');
        if (progress >= 50) indicators[1].classList.add('active');
        if (progress >= 75) indicators[2].classList.add('active');

        if (progress >= 100 && !isRecording) {
            clearInterval(progressInterval);
            startRecording();
        }
    }, 20);

    holdTimer = setTimeout(() => {
        holdTimer = null;
    }, HOLD_THRESHOLD_MS);
}

function handlePressEnd() {
    if (!callBtn.classList.contains('pressed')) return;
    callBtn.classList.remove('pressed');

    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    setProgress(0);
    indicators.forEach(ind => ind.classList.remove('active'));

    if (isRecording) {
        stopRecording();
    } else if (!hasSentThisPress) {
        hasSentThisPress = true;
        triggerCall();
    }
}

function startRecording() {
    isRecording = true;
    callBtn.classList.add('recording');
    indicators.forEach(ind => {
        ind.classList.remove('active');
        ind.classList.add('recording');
    });
    statusDiv.textContent = "Recording... Release to send.";
    audioChunks = [];

    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.start();

            mediaRecorder.addEventListener("dataavailable", event => {
                audioChunks.push(event.data);
            });

            mediaRecorder.addEventListener("stop", () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                sendAudioMessage(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            });
        })
        .catch(err => {
            console.error("Mic error:", err);
            statusDiv.textContent = "Microphone access denied.";
            resetButton();
        });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        hasSentThisPress = true;
        mediaRecorder.stop();
    }
    isRecording = false;
    resetButton();
}

function resetButton() {
    callBtn.classList.remove('recording', 'pressed');
    indicators.forEach(ind => ind.classList.remove('recording', 'active'));
    statusDiv.textContent = "";
}

function sendAudioMessage(blob) {
    statusDiv.textContent = "Sending voice message...";
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    startVisualRinging(); // Visual ring feedback for voice send too

    fetch('/api/call', {
        method: 'POST',
        body: formData
    })
        .then(r => r.json())
        .then(data => {
            statusDiv.textContent = "Voice message sent! Waiting for reply...";
            setTimeout(stopRinging, 500);
            startPolling();
        })
        .catch(err => {
            console.error(err);
            statusDiv.textContent = "Failed to send voice.";
        });
}

// Check for autoplay on load
const urlParams = new URLSearchParams(window.location.search);
const playUrl = urlParams.get('play');
if (playUrl) {
    statusDiv.innerHTML = "🔔 <b>New Voice Message!</b><br>Loading...";

    // Create a prominent play button immediately
    const playBtn = document.createElement('button');
    playBtn.textContent = "▶️ PLAY MESSAGE";
    playBtn.className = "btn-sub";
    playBtn.style.backgroundColor = "#2ed573"; // Green
    playBtn.style.marginTop = "20px";

    const container = document.getElementById('setup-section');
    container.insertBefore(playBtn, container.firstChild);

    const audio = new Audio(playUrl);

    playBtn.onclick = () => {
        audio.play()
            .then(() => {
                statusDiv.textContent = "Playing message...";
                playBtn.style.display = 'none';
            })
            .catch(e => {
                statusDiv.textContent = "Error playing: " + e.message;
            });
    };

    // Try auto-play
    audio.play()
        .then(() => {
            statusDiv.textContent = "Playing message automatically...";
            playBtn.style.display = 'none';
        })
        .catch(e => {
            console.log("Autoplay blocked:", e);
            statusDiv.textContent = "Tap the button above to listen.";
        });
}
