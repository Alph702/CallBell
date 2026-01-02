self.addEventListener("push", event => {
    const data = event.data.json();
    const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/727/727399.png', // Generic bell icon
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
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

    if (event.action) {
        // Action button clicked
        event.waitUntil(
            fetch("/api/reply", {
                method: "POST",
                body: JSON.stringify({ minutes: event.action }),
                headers: { "Content-Type": "application/json" }
            })
        );
    } else {
        // Main body clicked - just focus or open window?
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(windowClients => {
                // Check if there is already a window/tab open with the target URL
                for (var i = 0; i < windowClients.length; i++) {
                    var client = windowClients[i];
                    // If so, just focus it.
                    if (client.url === '/' && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If not, then open the target URL in a new window/tab.
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
        );
    }
});
