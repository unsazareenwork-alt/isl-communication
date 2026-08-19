import cv2
import mediapipe as mp
import joblib
import numpy as np
import pandas as pd

from preprocessing import normalize_landmarks


# =========================
# LOAD TRAINED MODEL
# =========================

model = joblib.load("isl_model.pkl")

print("Model loaded successfully.")


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
# IMAGE PATH
# =========================

image_path = "test.jpg"

image = cv2.imread(image_path)

if image is None:
    print("Could not load image.")
    hands.close()
    exit()


# =========================
# PROCESS IMAGE
# =========================

image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

results = hands.process(image_rgb)


if not results.multi_hand_landmarks:
    print("No hand detected.")
    hands.close()
    exit()


print("Number of hands detected:",
      len(results.multi_hand_landmarks))


# =========================
# EXTRACT NORMALIZED FEATURES
# =========================

left_features = [0.0] * 63
right_features = [0.0] * 63

for hand_landmarks, handedness in zip(
    results.multi_hand_landmarks,
    results.multi_handedness
):

    label = handedness.classification[0].label

    normalized = normalize_landmarks(
        hand_landmarks.landmark
    )

    if label == "Left":
        left_features = normalized

    elif label == "Right":
        right_features = normalized


# Same feature format used during training
features = left_features + right_features

print("Number of extracted features:", len(features))


# =========================
# CHECK FEATURE COUNT
# =========================

if len(features) != 126:

    print(
        "Feature count mismatch!"
        f" Expected 126, got {len(features)}"
    )

    hands.close()
    exit()


# =========================
# PREPARE FOR MODEL
# =========================

import pandas as pd

features = np.array(features).reshape(1, -1)

feature_names = [f"feature_{i}" for i in range(126)]

features = pd.DataFrame(
    features,
    columns=feature_names
)

# =========================
# PREDICT
# =========================

prediction = model.predict(features)[0]

probabilities = model.predict_proba(features)[0]

confidence = max(probabilities)


print("\n=========================")
print("Prediction:", prediction)
print("Confidence:", round(confidence, 4))
print("=========================")


hands.close()