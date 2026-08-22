import pandas as pd
import joblib

from sklearn.model_selection import (
    train_test_split,
    cross_val_score,
    StratifiedKFold
)
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score
)


# ==========================================
# FILE PATHS
# ==========================================

DATASET_FILE = "preprocessed_v3.csv"
MODEL_FILE = "isl_model_v3.pkl"


# ==========================================
# LOAD DATASET
# ==========================================

print("==========================================")
print("ISL MODEL V3 TRAINING")
print("==========================================")

print("\nLoading dataset...")

data = pd.read_csv(DATASET_FILE)

print("Dataset shape:", data.shape)


# ==========================================
# FEATURES AND LABEL
# ==========================================

X = data.drop("label", axis=1)
y = data["label"]

print("\nNumber of samples:", len(X))
print("Number of features:", X.shape[1])
print("Number of classes:", y.nunique())
print("Classes:", sorted(y.unique()))


# ==========================================
# DATA VALIDATION
# ==========================================

if X.shape[1] != 126:

    raise ValueError(
        f"Expected 126 features, "
        f"but found {X.shape[1]}"
    )


if y.nunique() != 26:

    raise ValueError(
        f"Expected 26 classes, "
        f"but found {y.nunique()}"
    )


if data.isnull().sum().sum() != 0:

    raise ValueError(
        "Dataset contains missing values."
    )


print("\nDataset validation passed.")


# ==========================================
# CLASS DISTRIBUTION
# ==========================================

print("\nSamples per class:")

print(
    y.value_counts()
    .sort_index()
)


# ==========================================
# TRAIN / TEST SPLIT
# ==========================================

print("\nCreating stratified train/test split...")

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("Training samples:", len(X_train))
print("Testing samples:", len(X_test))


# ==========================================
# CREATE MODEL
# ==========================================

model = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    n_jobs=-1
)


# ==========================================
# TRAIN
# ==========================================

print("\n==========================================")
print("TRAINING MODEL V3")
print("==========================================")

print("\nTraining Random Forest...")

model.fit(
    X_train,
    y_train
)

print("Model training completed.")


# ==========================================
# TEST SET PREDICTION
# ==========================================

print("\nGenerating test predictions...")

predictions = model.predict(X_test)


# ==========================================
# ACCURACY
# ==========================================

accuracy = accuracy_score(
    y_test,
    predictions
)


# ==========================================
# F1 SCORE
# ==========================================

macro_f1 = f1_score(
    y_test,
    predictions,
    average="macro"
)

weighted_f1 = f1_score(
    y_test,
    predictions,
    average="weighted"
)


# ==========================================
# TEST RESULTS
# ==========================================

print("\n==========================================")
print("V3 TEST SET RESULTS")
print("==========================================")

print(
    f"Accuracy: {accuracy:.4f}"
)

print(
    f"Accuracy (%): {accuracy * 100:.2f}%"
)

print(
    f"Macro F1: {macro_f1:.4f}"
)

print(
    f"Weighted F1: {weighted_f1:.4f}"
)


# ==========================================
# CLASSIFICATION REPORT
# ==========================================

print("\n==========================================")
print("CLASSIFICATION REPORT")
print("==========================================")

print(
    classification_report(
        y_test,
        predictions,
        digits=4
    )
)


# ==========================================
# CONFUSION MATRIX
# ==========================================

print("\n==========================================")
print("CONFUSION MATRIX")
print("==========================================")

labels = sorted(y.unique())

cm = confusion_matrix(
    y_test,
    predictions,
    labels=labels
)

print("\nLabels:")
print(labels)

print("\nMatrix:")
print(cm)


# ==========================================
# CROSS VALIDATION
# ==========================================

print("\n==========================================")
print("5-FOLD CROSS VALIDATION")
print("==========================================")

print(
    "\nRunning 5-fold cross-validation..."
)

cv_scores = cross_val_score(
    model,
    X,
    y,
    cv=5,
    scoring="accuracy",
    n_jobs=-1
)

print("\nCV Scores:")

for i, score in enumerate(
    cv_scores,
    start=1
):

    print(
        f"Fold {i}: {score:.4f} "
        f"({score * 100:.2f}%)"
    )


print(
    "\nMean CV Accuracy:",
    f"{cv_scores.mean():.4f}"
)

print(
    "Mean CV Accuracy (%):",
    f"{cv_scores.mean() * 100:.2f}%"
)

print(
    "CV Standard Deviation:",
    f"{cv_scores.std():.4f}"
)


# ==========================================
# SAVE MODEL
# ==========================================

print("\n==========================================")
print("SAVING MODEL")
print("==========================================")

joblib.dump(
    model,
    MODEL_FILE
)

print(
    f"\nModel saved as {MODEL_FILE}"
)


# ==========================================
# FINAL SUMMARY
# ==========================================

print("\n==========================================")
print("V3 TRAINING COMPLETED")
print("==========================================")

print("Samples:", len(X))
print("Features:", X.shape[1])
print("Classes:", y.nunique())
print(
    f"Test Accuracy: {accuracy * 100:.2f}%"
)
print(
    f"Macro F1: {macro_f1:.4f}"
)
print(
    f"Mean CV Accuracy: "
    f"{cv_scores.mean() * 100:.2f}%"
)

print("\n==========================================")