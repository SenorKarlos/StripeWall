# Discord Oauth2 Site Wall and Stripe Management

1: Pull Repo & Pull seperate PMSF install. Configure PMSF as fully restricted or to show perhaps areas and geojson, whatever you allow for free. Do not use discord auth/access config on this install.<br/>
note: I can't reccomend enough a CDN like cloudflare with authenticated origin pull support, SSL, and DNSSEC. Provided NGINX example covers standard SSL config & www-> root redirects.<br/>
2: Take oauth.php and insert into PMSF Root. create directory oauth. Edit config.php.example and save to this folder as config.php.<br/>
3: Create Discord bot in Discord Developer Console (or use existing bot), and ensure it has administrative privileges in your server (assign roles and manage members minimum).<br/>
4: Fill out config.ini.example and remove '.example'. Create database per your config and run the SQL at the bottom to make the tables.<br/>
5: Add redirect_url from your completed config.ini to your Discord Bot. (/login URL) <br/>
6: Create a webhook in Stripe, add the following events to the stripe webook, point to https://yourmap.com/webhook:<br/>
charge.refunded, customer.deleted, charge.succeeded, customer.subscription.created, customer.subscription.deleted, customer.subscription.updated, customer.updated, invoice.payment_failed<br\>
7: Start the bot with PM2 `pm2 start wall.js`. Read the PM2 docs to have the bot automatically start as a service in the event of a power failure, restart, or other issue.

## FAQ:
What does this bot do?
- This bot gatekeeps a discord role and manages discord users with stripe subscriptions. 

Does this bot take one-time payments?
- Not currently. I may add it in the future.

How does a user unsubscribe?
- Direct the user to your /subscribe URL, and they click "Unsubscribe". I may add a dedicated Unsubscribe page in the future.

What are fingerprint matches?
- Fingerprint matches mean the users have an identical device and IP address match. iPhones do not give up much information for fingerprinting so you may see common matches between iOS users which is why IP address is also used for matching. A Fingerprint match means the users matched both by fingerprint and IP Address. This does not mean a 100% for sure match, but it is very likely to be the same device. You will need to make a judgement call based on use, history, and the person(s) if you truly think sharing is occurring.
(this function currently needs work, recommending Map Access & User Guild logging be false currently as well, every fingerprint 'matches' and exceeeds message limits)

Is payment information safe?
- The bot does not deal directly with any payment information. The payment html page uses the Stripe.js Checkout directly on their service platform. The bot receives a token sent by stripe to assign payment information to a Customer the bot creates. We do not need to worry about payment information security for this as is it all in the hands of Stripe.

How do I manually assign people a donor role so that the bot wont remove?
- Simply use a different role from your controlled role and configure your PMSF Auth accordingly, or have the user visit the 'blank map' and change thier plan_id in the Database to 'Lifetime'.

How do I get the subscription plan_id?
- In Stripe Dashboard, go to Products > Click on the Product > Click on the Pricing Plan > Copy the ID from the Details section. Should look like `plan_If7w44wkjh479Sdf` or 'price_If7w44wkjh479Sdf' depending on when the product was created and your API version.

How do I make a webhook?
- In Stripe Dashboard, click on the Developers section > Click Webhooks > Click Add Endpoint. Select the events defined above.

Can I manage users in Stripe Manually?
- Yes you can. The bot syncs with Stripe every 6 hours and also will manage users based on any webhooks it receives.

# Credits

Original Code/Concept by wragru
PMSF - https://github.com/pmsf/PMSF
