import pandas as pd
import joblib

from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix
)

# ==========================================
# LOAD DATASET
# ==========================================

data = pd.read_csv("training_v2.csv")

print("Dataset shape:", data.shape)


# ==========================================
# FEATURES AND LABEL
# ==========================================

X = data.drop("label", axis=1)
y = data["label"]

print("Number of samples:", len(X))
print("Number of features:", X.shape[1])
print("Classes:", sorted(y.unique()))


# ==========================================
# TRAIN / TEST SPLIT
# ==========================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
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

print("\nTraining Model V2...")

model.fit(X_train, y_train)

print("Model training completed.")


# ==========================================
# TEST SET EVALUATION
# ==========================================

predictions = model.predict(X_test)

accuracy = accuracy_score(
    y_test,
    predictions
)

print("\n==============================")
print("TEST SET RESULTS")
print("==============================")

print("Accuracy:", accuracy)

print("\nClassification Report:")
print(
    classification_report(
        y_test,
        predictions
    )
)


# ==========================================
# CONFUSION MATRIX
# ==========================================

print("\nConfusion Matrix:")

print(
    confusion_matrix(
        y_test,
        predictions
    )
)


# ==========================================
# CROSS VALIDATION
# ==========================================

print("\n==============================")
print("5-FOLD CROSS VALIDATION")
print("==============================")

cv_scores = cross_val_score(
    model,
    X,
    y,
    cv=5,
    scoring="accuracy",
    n_jobs=-1
)

print("CV Scores:", cv_scores)

print(
    "Mean CV Accuracy:",
    cv_scores.mean()
)


# ==========================================
# SAVE MODEL
# ==========================================

joblib.dump(
    model,
    "isl_model_v2.pkl"
)

print("\nModel saved as isl_model_v2.pkl")
