
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

function triggerCall() {
    callBtn.disabled = true;
    callBtn.textContent = 'Calling...';
    callBtn.classList.add('ringing');
    statusDiv.textContent = 'Sending call...';

    fetch('/api/call', {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            console.log("Call result:", data);
            statusDiv.textContent = 'Call Sent! Waiting for reply...';
            callBtn.classList.remove('ringing');
            callBtn.textContent = 'Ring Initialized';

            // Start polling for reply
            startPolling();

            // Reset button after 5s
            setTimeout(() => {
                callBtn.disabled = false;
                callBtn.textContent = '🔔 RING BELL';
            }, 5000);
        })
        .catch(err => {
            statusDiv.textContent = 'Error sending call: ' + err.message;
            callBtn.disabled = false;
            callBtn.classList.remove('ringing');
        });
}

let pollInterval;
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    replyDiv.classList.remove('hidden');
    replyText.textContent = "Waiting for reply...";

    let attempts = 0;
    pollInterval = setInterval(() => {
        attempts++;
        if (attempts > 300) { // Stop after 10 mins (300 * 2s)
            clearInterval(pollInterval);
            statusDiv.textContent = "Timed out waiting for reply.";
            return;
        }

        fetch('/api/poll_reply')
            .then(r => r.json())
            .then(data => {
                if (data.message) {
                    clearInterval(pollInterval);
                    handleReply(data.message);
                }
            })
            .catch(e => console.log("Poll error", e));
    }, 2000);
}

function handleReply(message) {
    statusDiv.textContent = "Reply Received!";
    replyText.textContent = message;

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
let isRecording = false;
let hasSentThisPress = false; // Guard against duplicate sends
const HOLD_THRESHOLD_MS = 400; // Hold for 400ms to start recording

// Mouse events
callBtn.addEventListener('mousedown', handlePressStart);
callBtn.addEventListener('mouseup', handlePressEnd);
callBtn.addEventListener('mouseleave', handlePressEnd); // Cancel if mouse leaves

// Touch events for mobile
callBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handlePressStart(); });
callBtn.addEventListener('touchend', (e) => { e.preventDefault(); handlePressEnd(); });
callBtn.addEventListener('touchcancel', handlePressEnd);

function handlePressStart() {
    // Reset guard for this new press
    hasSentThisPress = false;

    // Start a timer - if held long enough, begin recording
    holdTimer = setTimeout(() => {
        holdTimer = null; // Clear the timer reference IMMEDIATELY
        startRecording();
    }, HOLD_THRESHOLD_MS);
}

function handlePressEnd() {
    // Clear the hold timer if it hasn't fired yet
    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }

    // If we were recording, stop and send the audio
    if (isRecording) {
        stopRecording();
    } else if (!hasSentThisPress) {
        // Quick tap - ring the bell without voice (only if we haven't sent already)
        hasSentThisPress = true;
        triggerCall();
    }
}

function startRecording() {
    isRecording = true;
    callBtn.textContent = "🎤 Recording...";
    callBtn.classList.add('recording');
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
        hasSentThisPress = true; // Mark as sent before the async stop completes
        mediaRecorder.stop();
    }
    isRecording = false;
    resetButton();
}

function resetButton() {
    callBtn.classList.remove('recording');
    callBtn.classList.remove('ringing');
    callBtn.textContent = "🔔 RING BELL";
    callBtn.disabled = false;
}



function sendAudioMessage(blob) {
    statusDiv.textContent = "Sending voice message...";
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    fetch('/api/call', {
        method: 'POST',
        body: formData
    })
        .then(r => r.json())
        .then(data => {
            statusDiv.textContent = "Voice message sent! Waiting for reply...";
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
    playBtn.className = "btn-call";
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
