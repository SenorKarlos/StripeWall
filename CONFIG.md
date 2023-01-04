## FULL CONFIG BREAKDOWN & EXPLANATIONS

# server

"listening_port": Port number to use for bot. Must match redirects in your webserver
"session_key": Random string for session encoding.
"site_name": Your site name
"site_url": Your site URL
"time_zone", "tz_text", "tz_locale": Used for setting time zone options in varios messaging and pages.
- Zone List: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones (TZ Database Name)
- Locale List: https://www.w3schools.com/jsref/tryit.asp?filename=tryjsref_tolocalestring_date_all (Choose how you want the date displayed)
- Text is displayed as typed where used


# sync

"on_startup": true or false to run sync on each start as well as by schedule
"times": Array of times, or single time string, to run sync. Examples from onTime library https://www.npmjs.com/package/ontime


# database

Standard option set for connecting to the database
  

# discord

"client_id": "000000000000000000",
"client_secret": "your client secret",
"bot_token": "your bot token",
"redirect_url": "https://yourdomain.site/login",
"guild_id": "000000000000000000",
"lifetime_role": false,
"inactive_lifetime_role": false,
"log_channel": "000000000000000000",
"welcome_channel": "000000000000000000",
"welcome_content": "Thank You For Your Purchase, %usertag%! Please visit the <#000000000000000000> channel to activate your services!",
"status_type": "WATCHING",
"status_text": "for subscribers",
"fetch_bans": true,
"blacklist": []
  

# pages

"general"

- "terms", "disclaimer", "warning": Customizable text for all pages
- "background": URL Image source for text frame background
- "outer_background": Color (by name) for outer background
- "border_color": Color (by hex) for border
- "title_color": Color (by name) for titles
- "text_color": Color (by name) for text


"checkout"

- "welcome":
- "success_url":
- "cancel_url":


"lifetime"

- "active_life_intro":
- "inactive_life_intro":


"manual"

- "manual_intro":
- "manual_text":


"blocked"

- "background":
- "outer_background":
- "border_color":
- "title_color":
- "button_link":
- "button_text":
  

# stripe

"live_pk":
"live_sk":
"wh_secret":
"calculated_statement_descriptor":
"alt_charge_text":
"alt_refund_text":
"rem_role_full_refund":
"rem_role_any_refund":
"radar_script":

"addresses"

- "billing":
- "shipping":


"taxes"

- "active":
- "automatic":
- "dynamic":
- "rate_ids":

- "rate_maps"
- "jurisdiction":
- "tax_rate":


"price_ids"

- "id":
- "role_id":
- "mode":
- "expiry":
- "title":
- "text":