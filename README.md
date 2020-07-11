# Discord Oauth2 Site Wall and Stripe Management

1: Pull Repo<br/>
2: Take index.php.example and insert into PMSF index.php file at line ##. If your File directory does not match what is in the example, you will need to alter it.<br/>
3: Create Discord bot in Discord Developer Console (or use existing bot), and ensure it has administrative privileges in your server (assign roles and manage members minimum).<br/>
4: Fill out config.ini.example and remove '.example'.<br/>
5: Add redirect_url from your completed config.ini to your Discord Bot.<br/>
6: Create a webhook in Stripe, add the following events to the stripe webook, point to https://yourmapurl.com/webhook (If you want console and discord logs):
- charge.refunded, customer.deleted, charge.succeeded, customer.subscription.created, customer.subscription.deleted, customer.subscription.updated, customer.updated, invoice.payment_failed<br\>
7: Start the bot with PM2 `pm2 start wall.js`. Read the PM2 docs to have the bot automatically start as a service in the event of a power failure, restart, or other issue.

## FAQ:
What does this bot do?
- This bot gatekeeps a webpage based on a discord role and manages discord users with stripe subscriptions. A small header is added to an existing index.php.

Does this bot take one-time payments?
- Not currently. I may add it in the future.

How does a user unsubscribe?
- Direct the user to your /subscribe URL, and they click "Unsubscribe". I may add a dedicated Unsubscribe page in the future.

What are fingerprint matches?
- Fingerprint matches mean the users have an identical device and IP address match. iPhones do not give up much information for fingerprinting so you may see common matches between iOS users which is why IP address is also used for matching. A Fingerprint match means the users matched both by fingerprint and IP Address. This does not mean a 100% for sure match, but it is very likely to be the same device. You will need to make a judgement call based on use, history, and the person(s) if you truly think sharing is occurring.

Is payment information safe?
- The bot does not deal directly with any payment information. The payment html page uses the Stripe.js Checkout directly on their service platform. The bot receives a token sent by stripe to assign payment information to a Customer the bot creates. We do not need to worry about payment information security for this as is it all in the hands of Stripe.

How do I manually assign people a donor role so that the bot wont remove?
- You need to have the user log into the map at least once. You will then need to go into the map_user table and modify their stripe_id to "Lifetime". Once done, you can assign your donor role and the bot will not remove it anymore. This is meant for lifetime users only.

How do I get the subscription plan_id?
- In Stripe Dashboard, go to Products > Click on the Product > Click on the Pricing Plan > Copy the ID from the Details section. Should look like `plan_If7w44wkjh479Sdf`.

How do I make a webhook?
- In Stripe Dashboard, click on the Developers section > Click Webhooks > Click Add Endpoint. Select the events defined above.

Can I manage users in Stripe Manually?
- Yes you can. The bot syncs with Stripe every 6 hours and also will manage users based on any webhooks it receives.

Why is the code obfuscated?
- This is not an open source program. It took a lot of work and learning on my part.
