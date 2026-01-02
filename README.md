# CallBell

CallBell is a Flask application designed to send push notifications to subscribed clients. It features a simple interface to trigger "Mom is calling" alerts with actionable reply options.

## Features
- **Push Notifications**: Send alerts to subscribed devices.
- **Interactive Actions**: Notifications include actions for quick replies (e.g., "1 min", "5 min").
- **Live Replies**: The sender can see replies in real-time.

## How to Run

This project uses `uv` for dependency management.

1.  **Run the application**:
    ```bash
    uv run app.py
    ```

2.  **Open in Browser**:
    Navigate to `http://localhost:5000` to subscribe and test notifications.
