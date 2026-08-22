import os
import cv2
import joblib
import numpy as np
import mediapipe as mp

from collections import deque, Counter


# ==========================================
# PATHS
# ==========================================

PROJECT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
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

# Diagnostic threshold
CONFIDENCE_THRESHOLD = 0.30

# Number of seconds before prediction starts
STARTUP_COUNTDOWN = 3


# ==========================================
# LOAD MODEL
# ==========================================

print("==========================================")
print("ISL REAL-TIME WEBCAM DIAGNOSTIC V3")
print("==========================================")

print("\nLoading Model V3...")

if not os.path.exists(MODEL_PATH):

    print("\nERROR: Model file not found!")
    print("Expected:")
    print(MODEL_PATH)

    raise SystemExit


model = joblib.load(MODEL_PATH)

print("Model loaded successfully.")

print("\nClasses:")
print(model.classes_)

print("\nExpected features:")
print(model.n_features_in_)


if model.n_features_in_ != 126:

    print("\nERROR: Model does not expect 126 features.")

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

        return None, 0


    left_hand = None
    right_hand = None


    for hand_landmarks, handedness in zip(
        results.multi_hand_landmarks,
        results.multi_handedness
    ):

        label = handedness.classification[0].label


        if label == "Left":

            left_hand = hand_landmarks.landmark


        elif label == "Right":

            right_hand = hand_landmarks.landmark


    # ======================================
    # 63 FEATURES PER HAND
    # ======================================

    left_features = [0.0] * 63
    right_features = [0.0] * 63


    if left_hand is not None:

        left_features = normalize_landmarks(
            left_hand
        )


    if right_hand is not None:

        right_features = normalize_landmarks(
            right_hand
        )


    # ======================================
    # 126 TOTAL FEATURES
    # ======================================

    features = (
        left_features +
        right_features
    )


    if len(features) != 126:

        return None, 0


    return (
        np.array(features).reshape(1, -1),
        len(results.multi_hand_landmarks)
    )


# ==========================================
# STABILIZER
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

    print("\nERROR: Could not open webcam.")

    hands.close()

    raise SystemExit


print("Webcam opened successfully.")


# ==========================================
# STARTUP COUNTDOWN
# ==========================================

countdown_start = cv2.getTickCount()

countdown_seconds = STARTUP_COUNTDOWN


while True:

    ret, frame = cap.read()


    if not ret:

        print("\nERROR: Could not read webcam frame.")

        break


    frame = cv2.flip(
        frame,
        1
    )


    elapsed = (
        cv2.getTickCount() - countdown_start
    ) / cv2.getTickFrequency()


    remaining = (
        STARTUP_COUNTDOWN - int(elapsed)
    )


    if remaining <= 0:

        break


    cv2.putText(
        frame,
        "ISL V3",
        (250, 150),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.5,
        (0, 255, 0),
        3
    )


    cv2.putText(
        frame,
        f"Starting in {remaining}",
        (180, 220),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.2,
        (255, 255, 255),
        3
    )


    cv2.putText(
        frame,
        "Get your hand ready...",
        (150, 270),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2
    )


    cv2.imshow(
        "ISL Real-Time Diagnostic V3",
        frame
    )


    key = cv2.waitKey(1) & 0xFF


    if key == ord("q"):

        cap.release()
        cv2.destroyAllWindows()
        hands.close()

        raise SystemExit


# ==========================================
# MAIN LOOP
# ==========================================

print("\n==========================================")
print("WEBCAM DIAGNOSTIC STARTED")
print("==========================================")

print("\nShow ONE English alphabet sign at a time.")

print("Try A, B, C, D, E first.")

print("\nPress Q to quit.\n")


frame_number = 0


while True:

    ret, frame = cap.read()


    if not ret:

        print("\nERROR: Could not read frame.")

        break


    frame_number += 1


    # ======================================
    # MIRROR
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


    # ======================================
    # DEFAULT VALUES
    # ======================================

    prediction_text = "No hand"

    raw_prediction_text = ""

    confidence_text = ""

    hand_text = "Hands detected: 0"

    feature_text = "Features: 0"


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
    # FEATURE EXTRACTION
    # ======================================

    features, hand_count = extract_features(
        results
    )


    hand_text = (
        f"Hands detected: {hand_count}"
    )


    if features is not None:

        feature_text = "Features: 126"


        # ==================================
        # RAW PREDICTION
        # ==================================

        prediction = model.predict(
            features
        )[0]


        # ==================================
        # PROBABILITIES
        # ==================================

        probabilities = model.predict_proba(
            features
        )[0]


        confidence = float(
            np.max(probabilities)
        )


        # ==================================
        # TOP 3 PREDICTIONS
        # ==================================

        top_indices = np.argsort(
            probabilities
        )[-3:][::-1]


        top_predictions = []


        for index in top_indices:

            sign = model.classes_[index]

            probability = probabilities[index]

            top_predictions.append(
                f"{sign}:{probability * 100:.1f}%"
            )


        raw_prediction_text = (
            f"Raw: {prediction}"
        )


        confidence_text = (
            f"Confidence: "
            f"{confidence * 100:.1f}%"
        )


        # ==================================
        # CONFIDENCE CHECK
        # ==================================

        if confidence >= CONFIDENCE_THRESHOLD:

            stable_prediction = (
                stabilize_prediction(
                    prediction
                )
            )

            prediction_text = (
                stable_prediction
            )


        else:

            prediction_history.clear()

            prediction_text = (
                "Low confidence"
            )


        # ==================================
        # TERMINAL DEBUG
        # ==================================

        if frame_number % 30 == 0:

            print(
                f"Frame {frame_number} | "
                f"Hands: {hand_count} | "
                f"Raw: {prediction} | "
                f"Confidence: "
                f"{confidence * 100:.2f}% | "
                f"Top 3: "
                f"{', '.join(top_predictions)}"
            )


    else:

        prediction_history.clear()


    # ======================================
    # DISPLAY
    # ======================================

    cv2.putText(
        frame,
        f"Sign: {prediction_text}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 0),
        2
    )


    cv2.putText(
        frame,
        raw_prediction_text,
        (20, 75),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )


    cv2.putText(
        frame,
        confidence_text,
        (20, 110),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )


    cv2.putText(
        frame,
        hand_text,
        (20, 145),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )


    cv2.putText(
        frame,
        feature_text,
        (20, 180),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )


    cv2.putText(
        frame,
        "V3 Diagnostic | A-Z | Q = quit",
        (20, 215),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (255, 255, 255),
        2
    )


    # ======================================
    # SHOW
    # ======================================

    cv2.imshow(
        "ISL Real-Time Diagnostic V3",
        frame
    )


    # ======================================
    # QUIT
    # ======================================

    key = cv2.waitKey(1) & 0xFF


    if key == ord("q"):

        break


# ==========================================
# CLEANUP
# ==========================================

cap.release()

cv2.destroyAllWindows()

hands.close()


print("\n==========================================")
print("WEBCAM DIAGNOSTIC V3 STOPPED")
print("==========================================")