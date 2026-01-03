self.addEventListener("push", event => {
    const data = event.data.json();
    console.log("Push received", data);
    console.log("Audio URL:", data.audioUrl);
    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/727/727399.png', // Generic bell icon
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1,
            audioUrl: data.audioUrl // Store audio URL
        },
        actions: data.actions || [],
        requireInteraction: true // Keeps notification until interaction
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    // Build the URL to open (with audio if available)
    let urlToOpen = '/';
    if (event.notification.data && event.notification.data.audioUrl) {
        urlToOpen = `/?play=${encodeURIComponent(event.notification.data.audioUrl)}`;
    }

    // If an action button was clicked, also send the reply
    const sendReply = event.action ?
        fetch("/api/reply", {
            method: "POST",
            body: JSON.stringify({ minutes: event.action }),
            headers: { "Content-Type": "application/json" }
        }) :
        Promise.resolve();

    // Open/focus the window AND send the reply
    event.waitUntil(
        Promise.all([
            sendReply,
            clients.matchAll({ type: 'window' }).then(windowClients => {
                // Check if there is already a window/tab open
                for (var i = 0; i < windowClients.length; i++) {
                    var client = windowClients[i];
                    // If so, just focus it and navigate
                    if (client.url.includes(self.registration.scope) && 'focus' in client) {
                        return client.focus().then(c => {
                            if (urlToOpen !== '/') c.navigate(urlToOpen);
                            return c;
                        });
                    }
                }
                // If not, then open the target URL
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
        ])
    );
});
