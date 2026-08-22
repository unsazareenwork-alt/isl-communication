import os
import cv2
import joblib
import numpy as np
import pandas as pd
import mediapipe as mp
import warnings

from collections import deque, Counter

from backend_client import BackendClient


# ==========================================
# SUPPRESS NON-FATAL SKLEARN WARNING
# ==========================================

warnings.filterwarnings(
    "ignore",
    message="`sklearn.utils.parallel.delayed` should be used with `sklearn.utils.parallel.Parallel`"
)


# ==========================================
# PATHS
# ==========================================

PROJECT_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        ".."
    )
)

MODEL_PATH = os.path.join(
    PROJECT_PATH,
    "isl_model_v3.pkl"
)


# ==========================================
# SETTINGS
# ==========================================

CAMERA_INDEX = 0

STABILIZATION_WINDOW = 5

STABLE_FRAMES_REQUIRED = 10

NO_HAND_FRAMES_TO_UNLOCK = 5

CONFIDENCE_THRESHOLD = 0.50


# ==========================================
# START
# ==========================================

print("==========================================")
print("ISL REAL-TIME WORD BUILDER V3")
print("WEBCAM → AI → WORD → BACKEND")
print("==========================================")


# ==========================================
# LOAD MODEL
# ==========================================

print("\nLoading Model V3...")

model = joblib.load(
    MODEL_PATH
)

print("Model loaded successfully.")

print("Classes:")
print(model.classes_)

print("Expected features:")
print(model.n_features_in_)


if model.n_features_in_ != 126:

    print(
        "\nERROR: Model does not expect "
        "126 features."
    )

    raise SystemExit


# ==========================================
# MEDIAPIPE
# ==========================================

mp_hands = mp.solutions.hands

mp_draw = mp.solutions.drawing_utils


hands = mp_hands.Hands(

    static_image_mode=False,

    max_num_hands=2,

    min_detection_confidence=0.5,

    min_tracking_confidence=0.5
)


# ==========================================
# BACKEND
# ==========================================

print("\n==========================================")
print("CONNECTING TO BACKEND")
print("==========================================")


backend = BackendClient()


if not backend.login():

    print(
        "\nERROR: Backend login failed."
    )

    hands.close()

    raise SystemExit


if not backend.create_meeting():

    print(
        "\nERROR: Meeting creation failed."
    )

    hands.close()

    raise SystemExit


print("\nAI → BACKEND READY")

print(
    "Meeting ID:",
    backend.meeting_id
)


# ==========================================
# NORMALIZATION
# ==========================================

def normalize_landmarks(landmarks):

    wrist = landmarks[0]

    relative_landmarks = []


    for landmark in landmarks:

        x = landmark.x - wrist.x

        y = landmark.y - wrist.y

        z = landmark.z - wrist.z


        relative_landmarks.append(
            [x, y, z]
        )


    max_value = max(

        abs(value)

        for landmark in relative_landmarks

        for value in landmark
    )


    if max_value == 0:

        max_value = 1


    normalized = []


    for landmark in relative_landmarks:

        for value in landmark:

            normalized.append(
                value / max_value
            )


    return normalized


# ==========================================
# FEATURE EXTRACTION
# ==========================================

def extract_features(results):

    if not results.multi_hand_landmarks:

        return None


    left_hand = None

    right_hand = None


    for (
        hand_landmarks,
        handedness
    ) in zip(

        results.multi_hand_landmarks,

        results.multi_handedness

    ):

        label = (
            handedness
            .classification[0]
            .label
        )


        if label == "Left":

            left_hand = (
                hand_landmarks.landmark
            )


        elif label == "Right":

            right_hand = (
                hand_landmarks.landmark
            )


    # ======================================
    # 63 FEATURES PER HAND
    # ======================================

    left_features = [0.0] * 63

    right_features = [0.0] * 63


    if left_hand is not None:

        left_features = (
            normalize_landmarks(
                left_hand
            )
        )


    if right_hand is not None:

        right_features = (
            normalize_landmarks(
                right_hand
            )
        )


    # ======================================
    # TOTAL = 126
    # ======================================

    features = (
        left_features +
        right_features
    )


    if len(features) != 126:

        return None


    feature_array = np.array(
        features
    ).reshape(1, -1)


    # ======================================
    # FEATURE NAME COMPATIBILITY
    # ======================================

    if hasattr(
        model,
        "feature_names_in_"
    ):

        features_df = pd.DataFrame(

            feature_array,

            columns=model.feature_names_in_

        )

        return features_df


    return feature_array


# ==========================================
# STABILIZATION
# ==========================================

prediction_history = deque(
    maxlen=STABILIZATION_WINDOW
)


def stabilize_prediction(prediction):

    prediction_history.append(
        prediction
    )


    counts = Counter(
        prediction_history
    )


    return counts.most_common(1)[0][0]


# ==========================================
# CAMERA
# ==========================================

print("\nOpening webcam...")


cap = cv2.VideoCapture(
    CAMERA_INDEX
)


if not cap.isOpened():

    print(
        "ERROR: Could not open webcam."
    )

    hands.close()

    raise SystemExit


print(
    "Webcam opened successfully."
)


print("\n==========================================")
print("ISL WORD BUILDER")
print("==========================================")

print(
    "Show A-Z signs to build a word."
)

print("")

print(
    "SPACE     -> Complete/send word"
)

print(
    "BACKSPACE -> Delete last character"
)

print(
    "C         -> Clear text"
)

print(
    "Q         -> Quit"
)

print("==========================================\n")


# ==========================================
# WORD BUILDER STATE
# ==========================================

text = ""

stable_prediction = None

stable_frame_count = 0

hand_present = False

no_hand_count = 0

letter_locked = False

last_confidence = 0.0


# ==========================================
# MAIN LOOP
# ==========================================

while True:

    ret, frame = cap.read()


    if not ret:

        print(
            "ERROR: Could not read frame."
        )

        break


    # ======================================
    # MIRROR CAMERA
    # ======================================

    frame = cv2.flip(
        frame,
        1
    )


    # ======================================
    # RGB
    # ======================================

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )


    # ======================================
    # MEDIAPIPE
    # ======================================

    results = hands.process(
        rgb
    )


    current_prediction = None

    current_confidence = 0.0


    # ======================================
    # DRAW LANDMARKS
    # ======================================

    if results.multi_hand_landmarks:

        for hand_landmarks in (
            results.multi_hand_landmarks
        ):

            mp_draw.draw_landmarks(

                frame,

                hand_landmarks,

                mp_hands.HAND_CONNECTIONS

            )


    # ======================================
    # HAND DETECTION
    # ======================================

    if results.multi_hand_landmarks:

        hand_present = True

        no_hand_count = 0


    else:

        hand_present = False

        no_hand_count += 1

        prediction_history.clear()

        stable_prediction = None

        stable_frame_count = 0


    # ======================================
    # FEATURE EXTRACTION
    # ======================================

    features = extract_features(
        results
    )


    # ======================================
    # PREDICTION
    # ======================================

    if features is not None:

        prediction = model.predict(
            features
        )[0]


        probabilities = (
            model.predict_proba(
                features
            )[0]
        )


        confidence = float(
            np.max(
                probabilities
            )
        )


        current_confidence = (
            confidence
        )


        # ==================================
        # CONFIDENCE CHECK
        # ==================================

        if (
            confidence
            >= CONFIDENCE_THRESHOLD
        ):

            stabilized = (
                stabilize_prediction(
                    prediction
                )
            )


            # ==============================
            # SAME PREDICTION
            # ==============================

            if (
                stabilized
                == stable_prediction
            ):

                stable_frame_count += 1


            else:

                stable_prediction = (
                    stabilized
                )

                stable_frame_count = 1


            current_prediction = (
                stabilized
            )


            # ==============================
            # LETTER CONFIRMATION
            # ==============================

            if (

                stable_frame_count
                >= STABLE_FRAMES_REQUIRED

                and not letter_locked

            ):

                text += stabilized

                letter_locked = True


                print(
                    f"\nLetter added: "
                    f"{stabilized}"
                )

                print(
                    f"Current text: "
                    f"{text}"
                )


        else:

            current_prediction = (
                "Low confidence"
            )


    else:

        current_prediction = (
            "No hand"
        )


    # ======================================
    # UNLOCK AFTER HAND REMOVAL
    # ======================================

    if (

        not hand_present

        and no_hand_count
        >= NO_HAND_FRAMES_TO_UNLOCK

    ):

        letter_locked = False


    # ======================================
    # DISPLAY TEXT
    # ======================================

    cv2.putText(

        frame,

        f"Current: {text}",

        (20, 45),

        cv2.FONT_HERSHEY_SIMPLEX,

        1,

        (0, 255, 0),

        2

    )


    # ======================================
    # DISPLAY SIGN
    # ======================================

    cv2.putText(

        frame,

        f"Sign: {current_prediction}",

        (20, 85),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.9,

        (0, 255, 0),

        2

    )


    # ======================================
    # DISPLAY CONFIDENCE
    # ======================================

    if current_confidence > 0:

        cv2.putText(

            frame,

            (
                f"Confidence: "
                f"{current_confidence * 100:.1f}%"
            ),

            (20, 120),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.65,

            (0, 255, 0),

            2

        )


    # ======================================
    # DISPLAY STATUS
    # ======================================

    if letter_locked:

        status = (
            "LETTER CONFIRMED - REMOVE HAND"
        )


    else:

        status = (
            "READY FOR NEXT LETTER"
        )


    cv2.putText(

        frame,

        status,

        (20, 155),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.6,

        (255, 255, 255),

        2

    )


    # ======================================
    # CONTROLS
    # ======================================

    cv2.putText(

        frame,

        (
            "SPACE=send word | "
            "BACKSPACE=delete | "
            "C=clear | Q=quit"
        ),

        (20, 190),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.5,

        (255, 255, 255),

        2

    )


    # ======================================
    # SHOW CAMERA
    # ======================================

    cv2.imshow(

        "ISL Word Builder V3",

        frame

    )


    # ======================================
    # KEYBOARD
    # ======================================

    key = cv2.waitKey(1) & 0xFF


    # ======================================
    # QUIT
    # ======================================

    if key == ord("q"):

        break


    # ======================================
    # CLEAR
    # ======================================

    elif key == ord("c"):

        text = ""

        print(
            "\nText cleared."
        )


    # ======================================
    # SPACE = COMPLETE WORD
    # ======================================

    elif key == 32:

        current_word = text.strip()


        if current_word:

            print("\n==========================================")
            print(
                f"COMPLETED WORD: {current_word}"
            )
            print("==========================================")


            # --------------------------------
            # SEND WORD TO BACKEND
            # --------------------------------

            success = backend.send_word(
                current_word
            )


            if success:

                print(
                    f"Word '{current_word}' "
                    f"successfully sent to backend."
                )

                # Start a new word

                text = ""


            else:

                print(
                    "Word was NOT sent to backend."
                )

                print(
                    "Keeping current text."
                )


        else:

            print(
                "No word to send."
            )


    # ======================================
    # BACKSPACE
    # ======================================

    elif key == 8:

        if len(text) > 0:

            text = text[:-1]


            print(
                f"\nDeleted. "
                f"Current text: {text}"
            )


# ==========================================
# CLEANUP
# ==========================================

cap.release()

cv2.destroyAllWindows()

hands.close()


# ==========================================
# FINAL OUTPUT
# ==========================================

print("\n==========================================")
print("ISL WORD BUILDER V3 STOPPED")
print("==========================================")

print(
    f"Remaining text: {text}"
)

print(
    "Backend meeting:",
    backend.meeting_id
)