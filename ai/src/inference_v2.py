import os
import sys
import cv2
import joblib
import numpy as np
import mediapipe as mp


# ==========================================
# PATHS
# ==========================================

# Project root:
# isl-communication/
# ├── ai/
# │   └── src/
# │       └── inference_v2.py
# └── isl_model_v2.pkl

AI_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

MODEL_PATH = os.path.join(
    AI_PATH,
    "isl_model_v2.pkl"
)
# ==========================================
# LOAD MODEL
# ==========================================

print("==========================================")
print("ISL INFERENCE V2")
print("==========================================")

print("\nLoading Model V2...")

model = joblib.load(MODEL_PATH)

print("Model loaded successfully.")


# ==========================================
# MEDIAPIPE
# ==========================================

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,
    min_detection_confidence=0.5
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
# PROCESS IMAGE
# ==========================================

def process_image(image_path):

    print("\nProcessing image:")
    print(image_path)

    image = cv2.imread(image_path)

    if image is None:

        print("ERROR: Could not read image.")

        return None

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    results = hands.process(image_rgb)

    if not results.multi_hand_landmarks:

        print("No hand detected.")

        return None

    print(
        "Hands detected:",
        len(results.multi_hand_landmarks)
    )

    # --------------------------------------
    # Separate Left and Right Hands
    # --------------------------------------

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

    # --------------------------------------
    # Create 63 features for each hand
    # --------------------------------------

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

    # --------------------------------------
    # Combine
    # --------------------------------------

    features = left_features + right_features

    print(
        "Number of features:",
        len(features)
    )

    if len(features) != 126:

        print("ERROR: Expected 126 features.")

        return None

    return np.array(features).reshape(1, -1)


# ==========================================
# MAIN
# ==========================================

if len(sys.argv) < 2:

    print("\nERROR: No image provided.")

    print(
        "\nUsage:"
    )

    print(
        'python ai/src/inference_v2.py "path_to_image"'
    )

    hands.close()

    sys.exit()


image_path = sys.argv[1]


# ==========================================
# RUN INFERENCE
# ==========================================

features = process_image(image_path)

if features is not None:

    # --------------------------------------
    # Prediction
    # --------------------------------------

    prediction = model.predict(
        features
    )[0]

    # --------------------------------------
    # Confidence
    # --------------------------------------

    probabilities = model.predict_proba(
        features
    )[0]

    confidence = np.max(
        probabilities
    )

    print("\n==========================================")
    print("PREDICTION")
    print("==========================================")

    print(
        "Predicted Sign:",
        prediction
    )

    print(
        "Confidence:",
        f"{confidence * 100:.2f}%"
    )


hands.close()

print("\nInference completed.")