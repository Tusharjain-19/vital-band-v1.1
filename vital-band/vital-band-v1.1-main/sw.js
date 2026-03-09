/* File: sw.js */
// Enhanced service worker with proper error handling and fallback data
self.addEventListener('push', event => {
  // Handle push events with fallback data if no payload
  const data = event.data ? event.data.json() : { title: 'Fitband', body: 'Fall detected!' };
  const options = { 
    body: data.body || 'Fall detected!',
    icon: '/icons/alert-icon.png',
    badge: '/icons/badge-icon.png',
    vibrate: [200, 100, 200]
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Fitband Alert', options)
  );
});

// Handle notification clicks to focus the app window
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      // Focus existing window if available, otherwise open new one
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});