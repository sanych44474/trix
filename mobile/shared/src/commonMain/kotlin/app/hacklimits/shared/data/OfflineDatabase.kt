package app.hacklimits.shared.data

import androidx.room3.ConstructedBy
import androidx.room3.Database
import androidx.room3.RoomDatabase
import androidx.room3.RoomDatabaseConstructor

/** Local source of truth for account-scoped cached responses and durable sync operations. */
@Database(
    entities = [CachedRecordEntity::class, OutboxEntity::class],
    version = 1,
    exportSchema = true,
)
@ConstructedBy(OfflineDatabaseConstructor::class)
abstract class OfflineDatabase : RoomDatabase() {
    abstract fun offlineDao(): OfflineDao
}

@Suppress("KotlinNoActualForExpect")
expect object OfflineDatabaseConstructor : RoomDatabaseConstructor<OfflineDatabase> {
    override fun initialize(): OfflineDatabase
}
