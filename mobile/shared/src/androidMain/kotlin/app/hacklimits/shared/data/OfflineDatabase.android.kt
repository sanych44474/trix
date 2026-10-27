package app.hacklimits.shared.data

import android.content.Context
import androidx.room3.Room
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.Dispatchers

fun createOfflineDatabase(context: Context): OfflineDatabase {
    val appContext = context.applicationContext
    val path = appContext.getDatabasePath("hacklimits-offline.db").absolutePath
    return Room.databaseBuilder<OfflineDatabase>(context = appContext, name = path)
        .setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.IO)
        .build()
}

fun createOfflineStore(context: Context): OfflineStore = RoomOfflineStore(createOfflineDatabase(context).offlineDao())
