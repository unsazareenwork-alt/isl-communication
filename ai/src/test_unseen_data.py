import os
import cv2
import joblib
import numpy as np
import pandas as pd
import mediapipe as mp

from preprocessing import normalize_landmarks


# =========================
# LOAD MODEL
# =========================

model = joblib.load("isl_model.pkl")

print("Model loaded successfully.")


# =========================
# DATASET PATH
# =========================

DATASET_PATH = r"C:\Users\goyal\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images\2. Teenagers ISL Images\Teenagers ISL images in Full Sleeves\English Alphabet"
CLASSES = ["A", "B", "C"]


# =========================
# MEDIAPIPE SETUP
# =========================

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,
    min_detection_confidence=0.5
)


# =========================
# PROCESS IMAGE
# =========================

def process_image(image_path):

    image = cv2.imread(image_path)

    if image is None:
        return None

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

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
        left_features = normalize_landmarks(left_hand)

    if right_hand is not None:
        right_features = normalize_landmarks(right_hand)

    return left_features + right_features


# =========================
# TEST DATA
# =========================

actual_labels = []
predicted_labels = []

print("\nStarting unseen-data testing...")


for label in CLASSES:

    class_path = os.path.join(DATASET_PATH, label)

    print(f"\nTesting class: {label}")

    # Test every image in A, B and C
    for filename in os.listdir(class_path):

        image_path = os.path.join(class_path, filename)

        features = process_image(image_path)

        if features is None:
            continue

        if len(features) != 126:
            continue

        features = np.array(features).reshape(1, -1)

        feature_names = [f"feature_{i}" for i in range(126)]

        features = pd.DataFrame(
            features,
            columns=feature_names
        )

        prediction = model.predict(features)[0]

        actual_labels.append(label)
        predicted_labels.append(prediction)


# =========================
# RESULTS
# =========================

from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix
)

accuracy = accuracy_score(
    actual_labels,
    predicted_labels
)

print("\n=========================")
print("UNSEEN DATA RESULTS")
print("=========================")

print("Images tested:", len(actual_labels))
print("Accuracy:", accuracy)

print("\nClassification Report:")
print(
    classification_report(
        actual_labels,
        predicted_labels
    )
)

print("\nConfusion Matrix:")
print(
    confusion_matrix(
        actual_labels,
        predicted_labels,
        labels=CLASSES
    )
)


hands.close()