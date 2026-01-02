
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
    navigator.serviceWorker.register('/static/sw.js')
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

    callBtn.addEventListener('click', function () {
        triggerCall();
    });
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
