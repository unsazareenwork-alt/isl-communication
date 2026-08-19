import os
import cv2
import joblib
import numpy as np
import pandas as pd
import mediapipe as mp

from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix
)

# ==========================================
# PATHS
# ==========================================

BASE_PATH = r"C:\Users\goyal\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images"

MODEL_PATH = "isl_model_v2.pkl"

KIDS_PATHS = [
    os.path.join(
        BASE_PATH,
        "1. Kids ISL images",
        "Kids ISL images in Full Sleeves",
        "English Alphabet"
    ),

    os.path.join(
        BASE_PATH,
        "1. Kids ISL images",
        "Kids ISL images in Half Sleeves",
        "English Alphabet"
    )
]

CLASSES = ["A", "B", "C"]


# ==========================================
# LOAD MODEL
# ==========================================

print("Loading Model V2...")

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

    image = cv2.imread(image_path)

    if image is None:
        return None

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    results = hands.process(image_rgb)

    if not results.multi_hand_landmarks:
        return None

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

    return left_features + right_features


# ==========================================
# TEST DATA
# ==========================================

true_labels = []
predicted_labels = []

processed = 0
failed = 0


print("\n==========================================")
print("TESTING MODEL V2 ON UNSEEN KIDS DATA")
print("==========================================")


for dataset_path in KIDS_PATHS:

    print("\n------------------------------------------")
    print("Dataset:")
    print(dataset_path)
    print("------------------------------------------")

    for label in CLASSES:

        class_path = os.path.join(
            dataset_path,
            label
        )

        print(f"\nTesting class: {label}")

        if not os.path.exists(class_path):

            print("WARNING: Folder not found!")
            continue

        for filename in os.listdir(class_path):

            image_path = os.path.join(
                class_path,
                filename
            )

            features = process_image(
                image_path
            )

            if features is None:

                failed += 1
                continue

            if len(features) != 126:

                failed += 1
                continue

            features = pd.DataFrame(
                [features],
                columns=model.feature_names_in_
            )

            prediction = model.predict(
                features
            )[0]
            
            true_labels.append(label)
            predicted_labels.append(prediction)

            processed += 1

        print(f"Finished class: {label}")


hands.close()


# ==========================================
# RESULTS
# ==========================================

print("\n==========================================")
print("UNSEEN KIDS RESULTS")
print("==========================================")

print("Images successfully tested:", processed)
print("Images failed:", failed)

accuracy = accuracy_score(
    true_labels,
    predicted_labels
)

print("\nAccuracy:", accuracy)

print("\nClassification Report:")

print(
    classification_report(
        true_labels,
        predicted_labels,
        labels=CLASSES
    )
)

print("\nConfusion Matrix:")

print(
    confusion_matrix(
        true_labels,
        predicted_labels,
        labels=CLASSES
    )
)