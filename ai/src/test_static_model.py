import os
import cv2
import joblib
import mediapipe as mp
import numpy as np


# ============================================================
# CONFIGURATION
# ============================================================

MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "..",
        "isl_model_v3.pkl"
    )
)

CONFIDENCE_THRESHOLD = 0.30


# ============================================================
# LOAD MODEL
# ============================================================

print("=" * 60)
print("ISL STATIC ALPHABET TEST")
print("=" * 60)

print("\nLoading static model...")
print("Model path:", MODEL_PATH)

if not os.path.exists(MODEL_PATH):
    print("\nERROR: Static model not found!")
    print("Expected:", MODEL_PATH)
    raise SystemExit(1)

model = joblib.load(MODEL_PATH)

print("Model loaded successfully.")
print("Model type:", type(model))
print("Number of classes:", len(model.classes_))
print("Classes:", model.classes_)
print("Number of features:", model.n_features_in_)


# ============================================================
# MEDIAPIPE
# ============================================================

print("\nInitializing MediaPipe Hands...")

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

print("MediaPipe ready.")


# ============================================================
# NORMALIZE HAND
# ============================================================

def normalize_hand(landmarks):

    points = np.array(
        [
            [lm.x, lm.y, lm.z]
            for lm in landmarks
        ],
        dtype=np.float32
    )

    # Wrist as origin
    wrist = points[0].copy()
    points = points - wrist

    # Scale normalization
    scale = np.max(
        np.linalg.norm(
            points,
            axis=1
        )
    )

    if scale > 0:
        points = points / scale

    return points.flatten()


# ============================================================
# EXTRACT 126 FEATURES
# ============================================================

def extract_features(frame):

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    result = hands.process(rgb)

    features = np.zeros(
        126,
        dtype=np.float32
    )

    if not result.multi_hand_landmarks:
        return features, False, result

    detected = {}

    if result.multi_handedness:

        for i, handedness in enumerate(
            result.multi_handedness
        ):

            label = (
                handedness
                .classification[0]
                .label
            )

            if label in ["Left", "Right"]:
                detected[label] = i

    # --------------------------------------------------------
    # Left hand = features 0-62
    # Right hand = features 63-125
    # --------------------------------------------------------

    for side, start in [
        ("Left", 0),
        ("Right", 63)
    ]:

        if side in detected:

            index = detected[side]

            hand_landmarks = (
                result
                .multi_hand_landmarks[index]
            )

            hand_features = normalize_hand(
                hand_landmarks.landmark
            )

            features[
                start:start + 63
            ] = hand_features

    return features, True, result


# ============================================================
# CAMERA
# ============================================================

print("\nOpening camera...")

cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("\nERROR: Could not open camera.")
    hands.close()
    raise SystemExit(1)

print("Camera opened successfully.")
print("\nPress Q to quit.")
print("Show an ISL alphabet sign to the camera.")
print("=" * 60)


# ============================================================
# REAL-TIME LOOP
# ============================================================

while True:

    ret, frame = cap.read()

    if not ret:
        print("ERROR: Could not read camera frame.")
        break

    features, detected, result = extract_features(
        frame
    )

    prediction = "No hand"
    confidence = 0.0

    if detected:

        # Reshape for Random Forest
        input_data = features.reshape(
            1,
            -1
        )

        probabilities = model.predict_proba(
            input_data
        )[0]

        best_index = np.argmax(
            probabilities
        )

        confidence = float(
            probabilities[best_index]
        )

        predicted_class = model.classes_[
            best_index
        ]

        prediction = str(
            predicted_class
        )

        # Confidence display
        if confidence < CONFIDENCE_THRESHOLD:
            display_prediction = "Uncertain"
        else:
            display_prediction = prediction

    else:
        display_prediction = "No hand"


    # ========================================================
    # DRAW HAND LANDMARKS
    # ========================================================

    if result.multi_hand_landmarks:

        for hand_landmarks in (
            result.multi_hand_landmarks
        ):

            mp_draw.draw_landmarks(
                frame,
                hand_landmarks,
                mp_hands.HAND_CONNECTIONS
            )


    # ========================================================
    # DISPLAY RESULT
    # ========================================================

    cv2.rectangle(
        frame,
        (10, 10),
        (390, 110),
        (0, 0, 0),
        -1
    )

    cv2.putText(
        frame,
        f"Prediction: {display_prediction}",
        (20, 50),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (255, 255, 255),
        2
    )

    cv2.putText(
        frame,
        f"Confidence: {confidence * 100:.1f}%",
        (20, 90),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )

    cv2.imshow(
        "ISL Static Alphabet Test",
        frame
    )


    # ========================================================
    # QUIT
    # ========================================================

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break


# ============================================================
# CLEANUP
# ============================================================

cap.release()
hands.close()
cv2.destroyAllWindows()

print("\nStatic alphabet test stopped.")