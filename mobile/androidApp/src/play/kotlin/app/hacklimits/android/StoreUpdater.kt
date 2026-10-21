package app.hacklimits.android

import android.content.Context
import app.hacklimits.shared.update.AppUpdater

/** Play builds update through Google Play only (PlayAppUpdater). */
internal fun storeUpdater(context: Context): AppUpdater = PlayAppUpdater(context)
