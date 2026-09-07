import requests

BASE_URL = "https://isl-communication.onrender.com"

# ============================================================
# YOUR ACCOUNT DETAILS
# ============================================================

EMAIL = "abc123@gmail.com"
PASSWORD = "vanshika"
NAME = "Vanshika"


# ============================================================
# SIGN UP
# ============================================================

print("=" * 60)
print("BACKEND ACCOUNT SETUP")
print("=" * 60)

print("\nCreating account...")

signup_response = requests.post(
    f"{BASE_URL}/api/auth/signup",
    json={
        "email": EMAIL,
        "password": PASSWORD,
        "name": NAME
    },
    timeout=60
)

print("Signup status:", signup_response.status_code)

try:
    print("Signup response:", signup_response.json())
except Exception:
    print("Signup response:", signup_response.text)


# ============================================================
# LOGIN
# ============================================================

print("\nLogging in...")

login_response = requests.post(
    f"{BASE_URL}/api/auth/login",
    json={
        "email": EMAIL,
        "password": PASSWORD
    },
    timeout=60
)

print("Login status:", login_response.status_code)

try:
    data = login_response.json()
    print("Login response received.")

except Exception:
    print("Login response:", login_response.text)
    raise SystemExit


# ============================================================
# GET TOKEN
# ============================================================

if login_response.ok:

    access_token = data["session"]["access_token"]

    print("\n" + "=" * 60)
    print("LOGIN SUCCESSFUL")
    print("=" * 60)

    print("Token received successfully.")
    print("Token length:", len(access_token))

    print("\nIMPORTANT:")
    print("Copy this token into your .env file.")
    print("Do NOT share the token with anyone.")

    print("\nYour token:")
    print(access_token)

else:

    print("\nLogin failed.")
    print(data)