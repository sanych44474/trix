# Compose, Ktor, kotlinx.serialization and Koin ship their own consumer shrinker rules.
# Add app rules only for a concrete reflective integration.
-keep class * extends androidx.room3.RoomDatabase { <init>(); }
