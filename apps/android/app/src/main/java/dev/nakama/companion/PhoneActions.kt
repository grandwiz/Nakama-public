package dev.nakama.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.time.Instant

data class ActionResult(val status: String, val message: String, val data: JSONObject? = null) {
    fun json() = JSONObject().put("status", status).put("message", message).apply { data?.let { put("data", it) } }
    companion object {
        fun fromJson(value: JSONObject) = ActionResult(value.getString("status"), value.getString("message"), value.optJSONObject("data"))
    }
}

/** Only structured owner requests reach this executor. Provider text is never parsed as an action. */
class PhoneActions(private val activity: Activity) {
    fun execute(action: JSONObject): ActionResult {
        val args = action.optJSONObject("args") ?: JSONObject()
        return try {
            when (action.getString("type")) {
                "call" -> call(args)
                "sms" -> sms(args)
                "calendar" -> calendar(args)
                "contacts_search" -> contacts(args)
                "open_app" -> openApp(args)
                "timer_start" -> RemotePhoneTimers.execute(activity, PairingVault(activity).load() ?: error("The pairing changed."), action)
                "whatsapp_message" -> whatsapp(args)
                "ui_read", "ui_tap", "ui_type", "ui_scroll", "ui_back" -> NakamaAccessibilityService.execute(action.getString("type"), args)
                else -> ActionResult("unsupported", "This version does not support '${action.optString("type")}'.")
            }
        } catch (error: Exception) {
            ActionResult("failed", error.message ?: "Android could not complete this action.")
        }
    }

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED
    private fun phone(args: JSONObject): String {
        val number = args.getString("number").trim()
        // Do not allow dialer control codes, separators, URI injection or silently chosen contacts.
        require(number.matches(Regex("\\+?[0-9 ()-]{3,30}"))) { "Provide an explicit phone number; dial codes are not supported." }
        return number
    }
    private fun call(args: JSONObject): ActionResult {
        val number = phone(args)
        val direct = args.optBoolean("direct", true)
        if (direct && !granted(Manifest.permission.CALL_PHONE)) return ActionResult("needs_permission", "Enable Phone permission in Nakama's Device tab, then request the call again.")
        activity.startActivity(Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)))
        return if (direct) ActionResult("started", "The call request was handed to Android. Connection and answer are not verified.")
        else ActionResult("needs_user", "The dialler is open. Tap Call to place the call.")
    }
    private fun sms(args: JSONObject): ActionResult {
        val message = args.getString("message")
        require(message.length <= 10_000) { "The message is too long." }
        activity.startActivity(Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", phone(args), null)).putExtra("sms_body", message))
        return ActionResult("needs_user", "The SMS draft is open. Review the recipient and tap Send; Nakama has not sent it.")
    }
    private fun calendar(args: JSONObject): ActionResult {
        val title = args.getString("title").trim()
        require(title.isNotEmpty() && title.length <= 300) { "Provide an event title." }
        val start = Instant.parse(args.getString("start")).toEpochMilli()
        val end = Instant.parse(args.getString("end")).toEpochMilli()
        require(end > start) { "The event end must be after its start." }
        val intent = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
            .putExtra(CalendarContract.Events.DESCRIPTION, args.optString("description"))
            .putExtra(CalendarContract.Events.EVENT_LOCATION, args.optString("location"))
        activity.startActivity(intent)
        return ActionResult("needs_user", "The calendar draft is open. Choose the correct account and save it; creation is not yet verified.")
    }
    private fun contacts(args: JSONObject): ActionResult {
        if (!granted(Manifest.permission.READ_CONTACTS)) return ActionResult("needs_permission", "Enable Contacts permission in Nakama's Device tab, then search again.")
        val query = args.getString("query").trim()
        require(query.length in 2..80) { "Use 2 to 80 characters for a contact search." }
        val matches = findContacts(query)
        return ActionResult("completed", if (matches.isEmpty()) "No matching contacts." else matches.joinToString("\n") { "${it.name}: ${it.number}" })
    }
    fun findContacts(query: String): List<ContactChoice> {
        require(granted(Manifest.permission.READ_CONTACTS)) { "Enable Contacts permission in the Device tab to resolve names. You can also use an explicit phone number." }
        require(query.length in 1..100) { "Use a contact name shorter than 100 characters." }
        val matches = mutableListOf<ContactChoice>()
        val uri = Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI, Uri.encode(query))
        activity.contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { cursor ->
            while (cursor.moveToNext() && matches.size < 20) matches += ContactChoice(cursor.getString(0), cursor.getString(1))
        }
        return matches.distinctBy { it.number.filter(Char::isDigit) }
    }
    private fun openApp(args: JSONObject): ActionResult {
        val packageName = args.getString("packageName")
        require(packageName.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+"))) { "Provide an Android package name." }
        val intent = activity.packageManager.getLaunchIntentForPackage(packageName)
            ?: return ActionResult("unsupported", "This app is not installed or does not have a launchable screen.")
        activity.startActivity(intent)
        return ActionResult("started", "The app was opened. No action inside it has been performed.")
    }
    private fun whatsapp(args: JSONObject): ActionResult {
        val number = phone(args).filter { it.isDigit() }
        val uri = Uri.Builder().scheme("https").authority("wa.me").appendPath(number).appendQueryParameter("text", args.getString("message")).build()
        activity.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage("com.whatsapp"))
        return ActionResult("needs_user", "WhatsApp's message draft is open. Check the contact and tap Send; delivery is not verified.")
    }
}
