import numpy as np
import pickle
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, confusion_matrix


# ============================================================
# CONFIG
# ============================================================

DATA_FILE = "ai/dynamic_landmarks_v4.npz"
MODEL_FILE = "ai/dynamic_model_v4.pkl"

RANDOM_STATE = 42
N_ESTIMATORS = 300
N_SPLITS = 5


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 60)
print("LOADING V4 DYNAMIC DATASET")
print("=" * 60)

data = np.load(DATA_FILE, allow_pickle=True)

X = data["X"]
y = data["y"]
video_names = data["video_names"]
signers = data["signers"]
detection_ratios = data["detection_ratios"]

print(f"X shape: {X.shape}")
print(f"y shape: {y.shape}")
print(f"Videos: {len(video_names)}")
print(f"Unique classes: {len(np.unique(y))}")
print(f"Unique signers: {len(np.unique(signers))}")


# ============================================================
# FLATTEN SEQUENCES
# ============================================================

# X = (samples, 30 frames, 126 features)
# RandomForest requires 2D input.

X_flat = X.reshape(X.shape[0], -1)

print(f"Flattened X shape: {X_flat.shape}")


# ============================================================
# ENCODE LABELS
# ============================================================

label_encoder = LabelEncoder()

y_encoded = label_encoder.fit_transform(y)

classes = label_encoder.classes_

print("\nClasses:")
for i, cls in enumerate(classes):
    print(f"  {i}: {cls}")


# ============================================================
# CLASS DISTRIBUTION
# ============================================================

print("\n" + "=" * 60)
print("CLASS DISTRIBUTION")
print("=" * 60)

unique, counts = np.unique(y, return_counts=True)

for cls, count in zip(unique, counts):
    print(f"{cls:15s}: {count}")


# ============================================================
# 5-FOLD STRATIFIED CROSS VALIDATION
# ============================================================

print("\n" + "=" * 60)
print("5-FOLD STRATIFIED CROSS VALIDATION")
print("=" * 60)

model_cv = RandomForestClassifier(
    n_estimators=N_ESTIMATORS,
    random_state=RANDOM_STATE,
    n_jobs=-1,
    class_weight="balanced"
)

cv = StratifiedKFold(
    n_splits=N_SPLITS,
    shuffle=True,
    random_state=RANDOM_STATE
)

scores = cross_val_score(
    model_cv,
    X_flat,
    y_encoded,
    cv=cv,
    scoring="accuracy",
    n_jobs=-1
)

for i, score in enumerate(scores, start=1):
    print(f"Fold {i}: {score * 100:.2f}%")

print(f"\nMean Accuracy: {scores.mean() * 100:.2f}%")
print(f"Std Dev:       {scores.std() * 100:.2f}%")


# ============================================================
# TRAIN FINAL MODEL ON ALL DATA
# ============================================================

print("\n" + "=" * 60)
print("TRAINING FINAL V4 MODEL")
print("=" * 60)

final_model = RandomForestClassifier(
    n_estimators=N_ESTIMATORS,
    random_state=RANDOM_STATE,
    n_jobs=-1,
    class_weight="balanced"
)

final_model.fit(X_flat, y_encoded)

print("Final model training complete!")


# ============================================================
# SAVE MODEL
# ============================================================

model_data = {
    "model": final_model,
    "label_encoder": label_encoder,
    "sequence_length": X.shape[1],
    "feature_size": X.shape[2],
    "classes": classes,
}

with open(MODEL_FILE, "wb") as f:
    pickle.dump(model_data, f)

print(f"\nModel saved to:")
print(MODEL_FILE)


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

print("\n" + "=" * 60)
print("TRAINING SUMMARY")
print("=" * 60)

print(f"Samples:          {X.shape[0]}")
print(f"Sequence length:  {X.shape[1]}")
print(f"Features/frame:   {X.shape[2]}")
print(f"Total features:   {X_flat.shape[1]}")
print(f"Classes:          {len(classes)}")
print(f"Trees:             {N_ESTIMATORS}")

print("\nCross-validation:")
print(f"Mean accuracy:    {scores.mean() * 100:.2f}%")
print(f"Std deviation:    {scores.std() * 100:.2f}%")

print("\n" + "=" * 60)
print("V4 TRAINING COMPLETE")
print("=" * 60)