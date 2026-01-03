from flask import Flask, request, jsonify, render_template
from pywebpush import webpush, WebPushException
import json
import os
import git

app = Flask(__name__)

# VAPID Keys
VAPID_PRIVATE_KEY = "hz8ShYsqWOKbdk9_SmitBnZb4_Y3UBzJrQBw3fhhQEM"
VAPID_PUBLIC_KEY = "BKOaLsFbCVw6BH3mCapc3H4py__t4xbYNOA3Q6yGAxY6xjFjyEb44ORJe4pQraAeX3OeuRCR7xlnIkozjWGGzBY"

VAPID_CLAIMS = {
    "sub": "mailto:test@localhost.com"
}

SUBSCRIPTIONS_FILE = 'subscriptions.json'
last_reply_message = None

def get_subscriptions():
    if not os.path.exists(SUBSCRIPTIONS_FILE):
        return []
    with open(SUBSCRIPTIONS_FILE, 'r') as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []

def save_subscription(sub_info):
    subs = get_subscriptions()
    # Check if already exists (naive check)
    if sub_info not in subs:
        subs.append(sub_info)
        with open(SUBSCRIPTIONS_FILE, 'w') as f:
            json.dump(subs, f)

def remove_subscription(sub_info):
    subs = get_subscriptions()
    if sub_info in subs:
        subs.remove(sub_info)
        with open(SUBSCRIPTIONS_FILE, 'w') as f:
            json.dump(subs, f)

@app.route('/git_update', methods=['POST'])
def git_update():
    # Git Url: https://github.com/Alph702/CallBell.git
    repo = git.Repo('./CallBell')
    origin = repo.remotes.origin
    repo.create_head('main',
                     origin.refs.main).set_tracking_branch(origin.refs.main).checkout()
    origin.pull()
    return '', 200

@app.route('/')
def index():
    return render_template('index.html', public_key=VAPID_PUBLIC_KEY)

@app.route('/sw.js')
def sw():
    response = app.send_static_file('sw.js')
    response.headers['Content-Type'] = 'application/javascript'
    return response

@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    subscription_info = request.json
    if not subscription_info:
        return jsonify({"error": "No subscription data"}), 400
    save_subscription(subscription_info)
    return jsonify({"status": "success"})

@app.route('/api/call', methods=['POST'])
def trigger_call():
    subs = get_subscriptions()
    
    # Check for audio file
    audio_url = None
    print(f"Request files: {request.files}")
    if 'audio' in request.files:
        audio_file = request.files['audio']
        if audio_file.filename != '':
            # Ensure uploads directory exists
            uploads_dir = os.path.join('static', 'uploads')
            os.makedirs(uploads_dir, exist_ok=True)
            
            # Save file with timestamp
            import time
            filename = f"voice_{int(time.time())}.webm"
            filepath = os.path.join(uploads_dir, filename)
            audio_file.save(filepath)
            audio_url = f"/static/uploads/{filename}"

    body_text = "How long until you come?"
    if audio_url:
        body_text = "🎤 Voice message received"

    payload = json.dumps({
        "title": "📢 Mom is calling",
        "body": body_text,
        "audioUrl": audio_url,
        "actions": [
            { "action": "1", "title": "1 min" },
            { "action": "5", "title": "5 min" },
            { "action": "10", "title": "10 min" }
        ]
    })
    
    results = []
    print(f"Sending push to {len(subs)} subscribers...")
    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS,
                ttl=60
            )
            results.append("sent")
        except WebPushException as ex:
            print(f"Push failed: {ex}")
            if ex.response is not None:
                print(f"Response body: {ex.response.text}")
            results.append(f"failed: {ex}")
            # If 410 Gone, remove subscription
            if ex.response and ex.response.status_code == 410:
                remove_subscription(sub)
    
    return jsonify({"results": results})

@app.route('/api/reply', methods=['POST'])
def reply():
    global last_reply_message
    data = request.json
    minutes = data.get('minutes', 'unknown')
    last_reply_message = f"I'll be there in {minutes} minutes."
    print(f"Received reply: {last_reply_message}")
    return jsonify({"status": "received"})

@app.route('/api/poll_reply')
def poll_reply():
    global last_reply_message
    if last_reply_message:
        msg = last_reply_message
        last_reply_message = None 
        return jsonify({"message": msg})
    return jsonify({"message": None})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
