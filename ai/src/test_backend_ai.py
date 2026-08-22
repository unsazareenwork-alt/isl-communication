import requests


# ==========================================
# BACKEND CONFIGURATION
# ==========================================

BACKEND_URL = "http://192.168.1.85:5000/api"

EMAIL = "abc123@gmail.com"
PASSWORD = "vanshika"


# ==========================================
# LOGIN
# ==========================================

print("==========================================")
print("AI → BACKEND CONNECTION TEST")
print("==========================================")

print("\nLogging in...")

login_response = requests.post(
    f"{BACKEND_URL}/auth/login",
    json={
        "email": EMAIL,
        "password": PASSWORD
    },
    timeout=10
)

print("Login status:", login_response.status_code)

login_data = login_response.json()

if not login_response.ok:
    print("Login failed:")
    print(login_data)
    raise SystemExit

access_token = login_data["session"]["access_token"]

print("Login successful.")
print("Access token received.")


# ==========================================
# CREATE MEETING
# ==========================================

print("\nCreating test meeting...")

headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

meeting_response = requests.post(
    f"{BACKEND_URL}/meetings/create",
    headers=headers,
    timeout=10
)

print("Meeting status:", meeting_response.status_code)

meeting_data = meeting_response.json()

if not meeting_response.ok:
    print("Meeting creation failed:")
    print(meeting_data)
    raise SystemExit

meeting = meeting_data["meeting"]

meeting_id = meeting["id"]
meeting_code = meeting["meeting_code"]

print("Meeting created successfully.")
print("Meeting ID:", meeting_id)
print("Meeting Code:", meeting_code)


# ==========================================
# SEND AI PREDICTION
# ==========================================

print("\nSending test AI prediction...")

prediction = {
    "meeting_id": meeting_id,
    "sign": "H",
    "confidence": 0.97,
    "language": "en"
}

prediction_response = requests.post(
    f"{BACKEND_URL}/ai/predict",
    headers=headers,
    json=prediction,
    timeout=10
)

print("Prediction status:", prediction_response.status_code)

prediction_data = prediction_response.json()

print("\nBackend response:")
print(prediction_data)


# ==========================================
# RESULT
# ==========================================

if prediction_response.status_code == 201:

    print("\n==========================================")
    print("SUCCESS!")
    print("AI → BACKEND CONNECTION WORKING")
    print("==========================================")

else:

    print("\n==========================================")
    print("AI PREDICTION WAS NOT SAVED")
    print("==========================================")