import os
import cv2
import joblib
import numpy as np
import pandas as pd
import mediapipe as mp
from collections import deque


# ==========================================
# PATHS
# ==========================================

# Project root:
# isl-communication/
# ├── ai/
# │   ├── isl_model_v2.pkl
# │   └── src/
# │       └── real_time_inference_v2.py

AI_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

MODEL_PATH = os.path.join(
    AI_PATH,
    "isl_model_v2.pkl"
)


# ==========================================
# DATASET FOLDER
# ==========================================

IMAGE_FOLDER = r"C:\Users\goyal\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images\3. Adults ISL Images"


# ==========================================
# SETTINGS
# ==========================================

IMAGES_PER_SIGN = 10

SIGNS_TO_TEST = [
    "A",
    "B",
    "C"
]

STABILIZATION_WINDOW = 5


# ==========================================
# LOAD MODEL
# ==========================================

print("==========================================")
print("ISL REAL-TIME INFERENCE V2")
print("SIMULATED FRAME MODE")
print("==========================================")

print("\nLoading Model V2...")

model = joblib.load(MODEL_PATH)

print("Model loaded successfully.")


# ==========================================
# MEDIAPIPE
# ==========================================

mp_hands = mp.solutions.hands

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
# FIND IMAGES
# ==========================================

def get_image_paths(folder):

    image_extensions = (
        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp"
    )

    selected_images = []

    # --------------------------------------
    # Find images for each sign
    # --------------------------------------

    for sign in SIGNS_TO_TEST:

        sign_images = []

        for root, directories, files in os.walk(folder):

            for file in files:

                if not file.lower().endswith(
                    image_extensions
                ):
                    continue

                filename = os.path.splitext(file)[0]

                if filename == sign or filename.startswith(
                    sign + " "
                ):

                    sign_images.append(
                        os.path.join(root, file)
                    )

        sign_images.sort()

        selected_images.extend(
            sign_images[:IMAGES_PER_SIGN]
        )

        print(
            f"{sign} images selected:",
            len(sign_images[:IMAGES_PER_SIGN])
        )

    return selected_images


# ==========================================
# PROCESS ONE FRAME
# ==========================================

def process_frame(image):

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    results = hands.process(image_rgb)

    if not results.multi_hand_landmarks:

        return None, 0

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
    # Create 63 features per hand
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

    if len(features) != 126:

        print(
            "ERROR: Expected 126 features, got",
            len(features)
        )

        return None, len(features)

    # --------------------------------------
    # Use model's original feature names
    # --------------------------------------

    feature_array = np.array(
        features
    ).reshape(1, -1)

    feature_names = model.feature_names_in_

    features_df = pd.DataFrame(
        feature_array,
        columns=feature_names
    )

    return (
        features_df,
        len(results.multi_hand_landmarks)
    )


# ==========================================
# PREDICTION STABILIZATION
# ==========================================

prediction_history = deque(
    maxlen=STABILIZATION_WINDOW
)


def stabilize_prediction(prediction):

    prediction_history.append(
        prediction
    )

    counts = {}

    for sign in prediction_history:

        counts[sign] = counts.get(
            sign,
            0
        ) + 1

    stable_sign = max(
        counts,
        key=counts.get
    )

    return stable_sign


# ==========================================
# SIGN EVENT DETECTOR
# ==========================================

last_emitted_sign = None


def detect_sign_event(stable_prediction):

    global last_emitted_sign

    if last_emitted_sign is None:

        last_emitted_sign = stable_prediction

        return stable_prediction

    if stable_prediction != last_emitted_sign:

        last_emitted_sign = stable_prediction

        return stable_prediction

    return None


# ==========================================
# AI OUTPUT
# ==========================================

def create_ai_output(sign, confidence):

    return {
        "sign": str(sign),
        "confidence": float(confidence)
    }

# ==========================================
# BACKEND HANDLER
# ==========================================

def handle_ai_prediction(sign, confidence):

    ai_output = create_ai_output(
        sign,
        confidence
    )

    print(">>> AI PREDICTION READY FOR BACKEND:")
    print(ai_output)

    return ai_output

# ==========================================
# GET IMAGES
# ==========================================

print("\nSearching for images...")

image_paths = get_image_paths(
    IMAGE_FOLDER
)

print(
    "\nTotal images selected:",
    len(image_paths)
)

print(
    "Sequence:",
    " → ".join(SIGNS_TO_TEST)
)

if len(image_paths) == 0:

    print("\nERROR: No images found.")

    hands.close()

    raise SystemExit


# ==========================================
# SIMULATED FRAME LOOP
# ==========================================

print("\nStarting simulated frames...")
print("Each image will be treated as one frame.")
print("==========================================")


for frame_number, image_path in enumerate(
    image_paths,
    start=1
):

    image = cv2.imread(image_path)

    if image is None:

        print(
            f"\nFrame {frame_number}: "
            "Could not read image."
        )

        continue

    features, hand_count = process_frame(
        image
    )

    print("\n------------------------------------------")

    print(
        "Frame:",
        frame_number
    )

    print(
        "Image:",
        os.path.basename(image_path)
    )

    print(
        "Hands detected:",
        hand_count
    )

    if features is None:

        print(
            "Prediction: No valid hand detected"
        )

        continue

    print(
        "Number of features:",
        features.shape[1]
    )

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

    # --------------------------------------
    # Stabilization
    # --------------------------------------

    stable_prediction = stabilize_prediction(
        prediction
    )

    sign_event = detect_sign_event(
    stable_prediction
    )

    print(
        "Frame Prediction:",
        prediction
    )

    print(
        "Stable Prediction:",
        stable_prediction
    )

    print(
        "Confidence:",
        f"{confidence * 100:.2f}%"
    )

    # --------------------------------------
    # AI OUTPUT FOR NEW SIGN
    # --------------------------------------
  

    if sign_event is not None:

        print(
            ">>> NEW SIGN EVENT:",
            sign_event
        )

        ai_output = handle_ai_prediction(
            sign_event,
            confidence
        )

# ==========================================
# CLEANUP
# ==========================================

hands.close()

print("\n==========================================")
print("SIMULATION COMPLETED")
print("==========================================")

# ==========================================
# STABILIZER NOISE TEST
# ==========================================

print("\n\n==========================================")
print("STABILIZER NOISE TEST")
print("==========================================")

test_sequences = {
    "Single wrong prediction": [
        "A", "A", "A", "B", "A"
    ],

    "Strong transition to B": [
        "A", "A", "B", "B", "B"
    ],

    "B with one noisy A": [
        "B", "B", "A", "B", "B"
    ],

    "Alternating predictions": [
        "A", "B", "A", "B", "A"
    ]
}


for test_name, sequence in test_sequences.items():

    prediction_history.clear()

    last_emitted_sign = None

    print("\n------------------------------------------")
    print("Test:", test_name)
    print("Sequence:", " ".join(sequence))

    for prediction in sequence:

        stable_prediction = stabilize_prediction(
            prediction
        )

        sign_event = detect_sign_event(
            stable_prediction
        )


        print(
            f"Input: {prediction} "
            f"→ Stable: {stable_prediction} "
            f"→ Event: {sign_event}"
        )