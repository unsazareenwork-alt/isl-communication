import requests


# ==========================================
# BACKEND CONFIGURATION
# ==========================================

BACKEND_URL = "https://isl-communication.onrender.com/api"

EMAIL = "abc123@gmail.com"

# Keep your existing backend password here.
PASSWORD = "vanshika"


# ==========================================
# BACKEND CLIENT
# ==========================================

class BackendClient:

    def __init__(self):

        self.access_token = None
        self.meeting_id = None
        self.headers = None


    # ======================================
    # LOGIN
    # ======================================

    def login(self):

        print("\nLogging into backend...")

        try:

            response = requests.post(

                f"{BACKEND_URL}/auth/login",

                json={
                    "email": EMAIL,
                    "password": PASSWORD
                },

                timeout=10
            )

        except requests.RequestException as error:

            print("Backend login request error:")
            print(error)

            return False


        print(
            "Login status:",
            response.status_code
        )


        try:

            data = response.json()

        except ValueError:

            print("Backend returned invalid JSON.")
            print(response.text)

            return False


        if not response.ok:

            print("Login failed:")
            print(data)

            return False


        self.access_token = (
            data["session"]["access_token"]
        )


        self.headers = {

            "Authorization":
                f"Bearer {self.access_token}",

            "Content-Type":
                "application/json"
        }


        print("Backend login successful.")

        return True


    # ======================================
    # CREATE MEETING
    # ======================================

    def create_meeting(self):

        if self.access_token is None:

            print(
                "ERROR: Login required before "
                "creating meeting."
            )

            return False


        print("\nCreating meeting...")


        try:

            response = requests.post(

                f"{BACKEND_URL}/meetings/create",

                headers=self.headers,

                timeout=10
            )

        except requests.RequestException as error:

            print(
                "Meeting request error:",
                error
            )

            return False


        print(
            "Meeting status:",
            response.status_code
        )


        try:

            data = response.json()

        except ValueError:

            print("Backend returned invalid JSON.")
            print(response.text)

            return False


        if not response.ok:

            print(
                "Meeting creation failed:"
            )

            print(data)

            return False


        meeting = data["meeting"]

        self.meeting_id = meeting["id"]


        print(
            "Meeting created successfully."
        )

        print(
            "Meeting ID:",
            self.meeting_id
        )

        print(
            "Meeting Code:",
            meeting["meeting_code"]
        )


        return True


    # ======================================
    # SEND AI PREDICTION
    # ======================================

    def send_prediction(
        self,
        sign,
        confidence,
        language="en"
    ):

        if self.meeting_id is None:

            print(
                "ERROR: Meeting required before "
                "sending prediction."
            )

            return False


        payload = {

            "meeting_id":
                self.meeting_id,

            "sign":
                str(sign),

            "confidence":
                float(confidence),

            "language":
                language
        }


        try:

            response = requests.post(

                f"{BACKEND_URL}/ai/predict",

                headers=self.headers,

                json=payload,

                timeout=10
            )


        except requests.RequestException as error:

            print(
                "Backend prediction request error:",
                error
            )

            return False


        if response.status_code == 201:

            print(
                f"Backend prediction sent: "
                f"{sign} "
                f"({confidence * 100:.1f}%)"
            )

            return True


        print(
            "Prediction failed:",
            response.status_code,
            response.text
        )

        return False


    # ======================================
    # SEND COMPLETED WORD
    # ======================================

    def send_word(
        self,
        word,
        language="en"
    ):

        if self.meeting_id is None:

            print(
                "ERROR: Meeting required before "
                "sending word."
            )

            return False


        word = word.strip()


        if not word:

            print(
                "ERROR: Cannot send empty word."
            )

            return False


        # ==================================
        # WORD PAYLOAD
        # ==================================

        payload = {

            "meeting_id":
                self.meeting_id,

            "sign":
                word,

            "confidence":
                1.0,

            "language":
                language
        }


        try:

            response = requests.post(

                f"{BACKEND_URL}/ai/predict",

                headers=self.headers,

                json=payload,

                timeout=10
            )


        except requests.RequestException as error:

            print(
                "Backend word request error:",
                error
            )

            return False


        if response.status_code == 201:

            print(
                f"Backend word sent: {word}"
            )

            return True


        print(
            "Word send failed:",
            response.status_code,
            response.text
        )

        return False


# ==========================================
# DIRECT TEST
# ==========================================

if __name__ == "__main__":

    client = BackendClient()

    if not client.login():
        raise SystemExit

    # Use the meeting already created earlier
    client.meeting_id = "f1704e58-3409-4b32-9f15-0b33ab618d9a"
    
    print("\nUsing existing meeting:")
    print(client.meeting_id)

    client.send_prediction(
        sign="H",
        confidence=0.97
    )

    client.send_word(
        word="HELLO"
    )