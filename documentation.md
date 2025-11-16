# SecureBank Bug Fix Documentation
**Author:** Cole Easton  
**Date:** 2025-11-15  

---

## Summary of Work  
 
### Issues fixed:  

#### Critical
| Ticket | Description | Status |
|---|---|---:|
| VAL-202 | Date of Birth Validation | ✅⚠️ |
| VAL-206 | Card Number Validation | ✅ |
| VAL-208 | Weak Password Requirements | ✅ |
| SEC-301 | SSN Storage | ✅ |
| SEC-303 | XSS Vulnerability | ✅ |
| PERF-401 | Account Creation Error | ✅ |
| PERF-405 | Missing Transactions | ✅ |
| PERF-406 | Balance Calculation | ⚠️ |
| PERF-408 | Resource Leak | ✅(⚠️) |


#### High
| Ticket | Description | Status |
|---|---|---:|
| VAL-201 | Email Validation Problems | ❌ |
| VAL-205 | Zero Amount Funding | ❌ |
| VAL-207 | Routing Number Optional | ❌ |
| VAL-210 | Card Type Detection | ✅ |
| SEC-302 | Insecure Random Numbers | ❌ |
| SEC-304 | Session Management | ❌ |
| PERF-403 | Session Expiry | ❌ |
| PERF-407 | Performance Degradation | ✅ |


#### Medium
| Ticket | Description | Status |
|---|---|---:|
| UI-101 | Dark Mode Text Visibility | ❌ |
| VAL-203 | State Code Validation | ❌ |
| VAL-204 | Phone Number Format | ❌ |
| VAL-209 | Amount Input Issues | ❌ |
| PERF-402 | Logout Issues | ❌ |
| PERF-404 | Transaction Sorting | ✅ |


---
## Test Coverage

To provide a sample for what tests should look like and a framework for adding further tests, Vitest is used for a small selection of tests:

- **SSN Encryption/Decryption:** Unit tests in `tests/encryption.test.ts` using Vitest to ensure encrypted SSNs can be decrypted and produce non-repeating ciphertexts.  
- **Resource Leak / SQLite Singleton:** Unit tests in `tests\db.test.ts` confirmed that the singleton connection works by checking that multiple imports do not create new connections.  


---

## Detailed Issue Reports

### Ticket SEC-301: SSN Storage
**Priority:** Critical 
**Status:** Fixed

#### Root Cause
The user's SSN is written as typed in the frontend directly to the database.

#### Fix Implemented
I added an encryption/decryption utility at `lib/security/encryption.js` which encrypts data using `AES-256-GCM` as implemented in the built-in `node:crypto` module.  I used this utility to encrypt the SSN in `server/router/auth.ts`:
```ts
const encryptedSSN = encrypt(input.ssn);

      await db.insert(users).values({
        ...input,
        password: hashedPassword,
        ssn: encryptedSSN,
      });
```
Unlike the password field, which was hashed, we encrypt the SSN because we may reasonably need to access it for legitimate business purposes.

Since this fixes the issue for future users, but does not retroactively fix the database for existing users, we need to be able to encrypt the SSNs in the existing database.  To do this, I imported the `encrypt` function into `scripts/db-utils.js` and added an `encrypt-ssns` command:
```js
else if (command === "encrypt-ssns") {
  console.log("\n=== Encrypting existing SSNs ===");

  const users = db.prepare("SELECT id, ssn FROM users").all();

  if (users.length === 0) {
    console.log("No users found.");
  } else {
    const update = db.prepare("UPDATE users SET ssn = ? WHERE id = ?");

    users.forEach((user) => {
      if (user.ssn && !user.ssn.includes(":")) { // crude check to avoid double-encrypting
        const encrypted = encrypt(user.ssn);
        update.run(encrypted, user.id);
        console.log(`Encrypted SSN for user ID ${user.id}`);
      }
    });

    console.log("All SSNs encrypted.");
  }
}
```
In order to use this quickly, I also added the following script to `package.json`:
```json
"db:encrypt-ssns": "node scripts/db-utils.js encrypt-ssns"
```
This enables the command to be easily run on the production database.

(Note that the encryption utility was written in JavaScript rather than TypeScript so that it could be imported into `db-util.js`.)

#### Comments
`encryption.js` contains the lines 
```js
const key = Buffer.from(
    process.env.ENCRYPTION_KEY ??
    "0123456789abcdef0123456789abcdef", // fallback for assessment evaluators
    "utf8"
);
``` 
The fallback is purely for the purposes of the assessment to minimize setup needed for the hiring manager; for an actual application, each developer would keep the key in their own `.env` file, and no fallback would be provided.  A .env.example file is included as an example of what the `.env` file should look like.

#### Testing
To test the encryption methods, I installed and set up Vitest and created `tests/db.test.ts`.
```ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../lib/security/encryption";

describe("SSN Encryption / Decryption", () => {
  it("should decrypt an encrypted value back to the original", () => {
    const original = "123-45-6789";
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  // having identical encrypted entries in a database provides valuable info to bad actors
  it("should produce different ciphertexts even for the same input", () => {
    const value = "987-65-4321";
    const enc1 = encrypt(value);
    const enc2 = encrypt(value);

    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(value);
    expect(decrypt(enc2)).toBe(value);
  });
});
```
Moreover, to ensure that the encryption was applied to the database, I created a new user after implementing the change.  I temporarily modified `db.utils` so that `npm run db:list-users` also includes the SSN.  I then ran this command and checked that the SSN on the new user was uncrypted.  Since I had already created users with unencrypted SSNs, I then ran `npm run db:encrypt-ssns`, the command I just created, and then reran `npm run db:list-users` to verify that the SSNs were encrypted.  I then reverted these modifications to `db.utils`. 

### Ticket VAL-202: Date of Birth Validation
**Priority:** Critical 
**Status:** Fixed with caveats (see comments)

#### Root Cause
No checks were in place to ensure that users were at least 18 years of age.  

#### Fix Implemented
Checks were implemented in the backend first, and this is the most critical place to check, since front-end checks could be overwritten using Postman, curl, etc., and the database needs to be compliant should it be audited by government regulators.  The following shows the `.refine` that was added to the `dateOfBirth` field in the Zod schema for the signup data in `server/routers/auth.ts`.

```ts
// example
dateOfBirth: z.string().refine((dob) => {
          const birth = new Date(dob);
          const now = new Date();
          const age =
            now.getFullYear() -
            birth.getFullYear() -
            (now.getMonth() < birth.getMonth() ||
              (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
              ? 1
              : 0);

          return age >= 18;
        }, {
          message: "Users must be at least 18 years of age to create an account."
        }),
```

Moreover, for a seamless user experience, these checks were mirrored on the frontend in `app/signup/page.tsx`: 

```tsx
                <input
                  {...register("dateOfBirth", {
                    required: "Date of birth is required",
                    validate: {
                      isAdult: (value) => {
                        const birth = new Date(value);
                        const now = new Date();
                        const age =
                          now.getFullYear() -
                          birth.getFullYear() -
                          (now.getMonth() < birth.getMonth() ||
                            (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
                            ? 1
                            : 0);
                        return age >= 18 || "Users must be at least 18 years of age to create an account.";
                      }
                    }
                  })}
                  type="date"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
```

#### Comments
- A more maintainable architecture could involve defining and exporting a Zod schema in one place, and then using that schema for both front- and back-end validation.  This way, we have a single source of truth, and do not need to make changes to two places.  

- This solution interprets the entered DOB as UTC and localizes to client time when getting the month, day, and year.  If the client is in a different time zone from the server, there may be disagreement between the front- and back-ends regarding whether the user has turned 18.  But since there is less than a 1-day discrepancy between times anywhere in the world, I believe that my solution is compliant with US common law, as contrary to naive expectation, one becomes legally a year older at the first minute of the day *before* their birthday.  We should work with legal to make this more rigorous, implement state-specific and international laws, and assess whether local time or server time is the source of truth regarding age.  This is potentially a sizeable project on its own.

### Ticket VAL-206: Card Number Validation
**Priority:** Critical  
**Status:** Fixed   

#### Root Cause
Only primitive checks were in place -- the system allowed exactly those cards whose card numbers were 16 digits long and that started with `4` or `5` in `components/FundingModal.tsx`.

#### Fix Implemented
I consulted [this table on Wikipedia](https://en.wikipedia.org/wiki/Payment_card_number#Issuer_identification_number_(IIN)) to allow support for the patterns of all major cards.  This entailed allowing a broader range of lengths (Amex card numbers are 15 numbers, for example) and validating the IIN numbers against the known issuing networks. Most networks validate card numbers using the [Luhn algorithm](https://en.wikipedia.org/wiki/Luhn_algorithm), so we validate card numbers using this algorithm where appropriate.  Since LankaPay does not use the Luhn algorithm, we allow all 16-digit card numbers that begin with `357111`.  We note that Diners Club enRoute also does not have validation, but, since this card also does not have a provided IIN range, the best we could do to allow these cards is allow all 15-digit card numbers, which would undermine the value of this fix for American Express users.  It seems, however, that [this card has been largely phased out](https://www.flyertalk.com/forum/air-canada-aeroplan/12859-enroute-card-being-phased-out-sort.html) and replaced with Diners Club International, which is supported, so my assessment is that that dropping support for Diners Club enRoute is an acceptable tradeoff for more rigorous checks on other 15-digit cards.

Since this is a user-experience issue, it is implemented on the frontend in `components/FundingModal.tsx`.  If users attempt to bypass this check using Postman or similar, they simply risk inconveniencing themselves, as the card may be rejected by the payment processor.

We note that these changes cannot guarantee that the card number was actually issued without making an API call to the issuing network, but this should be handled by the backend (not addressed in this fix because SecureBank is not a real bank).


### Ticket VAL-210: Card Type Detection
**Priority:** High
**Status:** Fixed

#### Root Cause
Only primitive checks were in place -- the system allowed exactly those cards whose card numbers were 16 digits long and that started with `4` or `5` in `components/FundingModal.tsx`.

#### Fix Implemented
The fixes described above to `VAL-206` also resolve this ticket.


### Ticket VAL-208: Weak Password Requirements
**Priority:** Critical
**Status:** Fixed

#### Root Cause
The front-end checked only required a length of 8 and that the password contained a number, checked in `app/signup/page.tsx`, and the back-end only required a length of 8, checked in  `server/routers/auth.ts`.   

#### Fix Implemented
Now, both the front- and back-end require a length of 8, a number, symbol, capital letter, and lowercase letter.

The new check in `app/signup/page.tsx` is: 
```tsx
<input
                  {...register("password", {
                    required: "Password is required",
                    minLength: {
                      value: 8,
                      message: "Password must be at least 8 characters",
                    },
                    validate: {
                      notCommon: (value) => {
                        const commonPasswords = ["password", "12345678", "qwerty"];
                        return !commonPasswords.includes(value.toLowerCase()) || "Password is too common";
                      },
                      hasNumber: (value) => /\d/.test(value) || "Password must contain a number",
                      hasUpper: (value) => /[A-Z]/.test(value) || "Password must contain an uppercase letter",
                      hasLower: (value) => /[a-z]/.test(value) || "Password must contain a lowercase letter",
                      hasSymbol: (value) => /[!@#$%^&*(),.?":{}|<>]/.test(value) || "Password must contain a symbol",
                    },
                  })}
                  type="password"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                />
```
And in `server/routers/auth.ts` is:
```ts
password: z.string().min(8)
          .refine(value => /\d/.test(value), {
            message: "Password must contain a number",
          })
          .refine(value => /[A-Z]/.test(value), {
            message: "Password must contain an uppercase letter",
          })
          .refine(value => /[a-z]/.test(value), {
            message: "Password must contain a lowercase letter",
          })
          .refine(value => /[!@#$%^&*(),.?":{}|<>]/.test(value), {
            message: "Password must contain a symbol",
          }),
```

### Ticket SEC-303: XSS Vulnerability
**Priority:** Critical
**Status:** Fixed

#### Root Cause
Before commit `118516c`, Line 71 of `components/TransactionList.tsx` contained the line:
```tsx
{transaction.description ? <span dangerouslySetInnerHTML={{ __html: transaction.description }} /> : "-"}
```  
This treats the transaction description as HTML, potentially allowing dangerous `<script>` elements to be executed by the client.

#### Fix Implemented
Line 71 of `components/TransactionList.tsx` was changed to ```tsx 
<span>{transaction.description || "-"}</span>
``` in commit `118516c` which treats the description as text and mitigates the potential for XSS attacks. 

### Ticket PERF-401: Account Creation Error
**Priority:** Critical
**Status:** Fixed

#### Root Cause
In `server/routers/account.ts`, before commit `4588954`, lines 57 - 67 read:
```ts
return (
        account || {
          id: 0,
          userId: ctx.user.id,
          accountNumber: accountNumber!,
          accountType: input.accountType,
          balance: 100,
          status: "pending",
          createdAt: new Date().toISOString(),
        }
      );
```
This means that when an account does not exist, the server will fabricate a fake account to mask the backend failure.  

#### Fix Implemented
Commit `4588954` changes the above lines to:
```ts
      if (!account) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account. Please try again.",
        });
      }

      return account;
```

This way, there is not a data correctness violation, and no data is guessed or inferred. The error handling is already handled correctly on the front-end; in `components/AccountCreationModal.tsx`, it is handled by lines 21-26 as of the initial commit:

```tsx
    try {
      await createAccountMutation.mutateAsync({ accountType });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to create account");
    }
```

### Ticket PERF-405: Missing Transactions
**Priority:** Critical
**Status:** Fixed

#### Root Cause
Line 10 of `components/TransactionList.tsx` reads:
```tsx
const { data: transactions, isLoading } = trpc.account.getTransactions.useQuery({ accountId });
```
This line queries the transactions for the current user's account and caches the result.  When the line 
```tsx
  const fundAccountMutation = trpc.account.fundAccount.useMutation();
```
is run in `components/FundingModal.tsx`, the cached result remains unchanged.

#### Fix Implemented
The line in `components/FundingModal.tsx` reference above was replaced with 
```tsx
  const utils = trpc.useUtils();
  const fundAccountMutation = trpc.account.fundAccount.useMutation({
    onSuccess: () => {
      utils.account.getTransactions.invalidate({ accountId });
      onSuccess();
    },
  });
```
This invalidates the data currently being used by `components/TransactionList.tsx`, and forces it to query the database again.

#### Testing
Before this change, newly created transactions would not appear in my account.  Sometimes, switching back and forth between accounts could make them appear, but the only way I could make it work with certainty was to log out and then back in again.
After the change, new transactions appear immediately when funding the account.

### Ticket PERF-407: Performance Degradation
**Priority:** High
**Status:** Fixed with caveats (see comment)

#### Root Cause
 `server/routers/account.ts` previously contained the code 
```ts
const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId));

      const enrichedTransactions = [];
      for (const transaction of accountTransactions) {
        const accountDetails = await db.select().from(accounts).where(eq(accounts.id, transaction.accountId)).get();

        enrichedTransactions.push({
          ...transaction,
          accountType: accountDetails?.accountType,
        });
      }
```
Notice that the `accountDetails` are queried each iteration of the loop, leading to a potentially large number of database queries, each for the purpose of acquiring the `accountType`for the **same account**.  

#### Comment 
Another potential performance issue is that there is no limit to the number of transactions that can be displayed at once, leading to potential performance issues with the browser.  It may be better to paginate the transaction list so that smaller chunks of data are queried and displayed at a time.  This would be a significant update, and is not included in this fix.

#### Fix Implemented
Directly above the code block above are the lines:
```tsx
const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }
```
So, we've already queried the account, meaning that we can simply access its type without querying the database for each transaction.  Thus, we replace the `for` loop with 
```tsx
for (const transaction of accountTransactions) {
  enrichedTransactions.push({
    ...transaction,
    accountType: account.accountType,
  });
}
```
Without performing a database query each iteration, the operation is significantly faster.


### Ticket PERF-404: Transaction Sorting
**Priority:** Medium
**Status:** Fixed

#### Root Cause
`server/routers/account.ts` queries the transactions by running
```ts
const accountTransactions = await db
  .select()
  .from(transactions)
  .where(eq(transactions.accountId, input.accountId));
```
Since SQL databases never guarantee order unless explicitly requested, the list of transactions may be in any order.  In practice, this implementation seems to return them in roughly ascending order.

#### Fix Implemented
I chained an `.orderBy()` onto to query; the updated code is as follow:
```ts
const accountTransactions = await db
  .select()
  .from(transactions)
  .where(eq(transactions.accountId, input.accountId))
  .orderBy(desc(transactions.createdAt));
```
Since most banking applications have the most recent transactions at the top, I ordered them in descending as seen in the last line above.  This entailed importing `desc` from Drizzle by modifying line 6 of `account.ts` to:
```ts
import { eq, and, desc } from "drizzle-orm";
```

#### Testing
Before this fix, the transactions appeared in roughly ascending order.  After the fix, they appear in descending order, indicating that it worked as intended.

### Ticket PERF-406: Balance Calculation
**Priority:** Critical
**Status:** Partially fixed

#### Root Cause
One source of this issue is that in `server/routers/account.ts`, we have the code
```ts
for (let i = 0; i < 100; i++) {
  finalBalance = finalBalance + amount / 100;
}
```
By shifting the significant digits (significand/mantissa) of the `amount` float to the right, those that extend beyong the end of `finalBalance`'s significand are truncated.  This is unnecessary, as the loop is mathematically (but not programmatically) 
equivalent to 
```ts
finalBalance += amount;
```
which leads to fewer bits of the significant being truncated.

#### Fix Implemented
The above loop was replaced with
```ts
finalBalance += amount;
```

#### Additional Changes Needed
The floating point issue described above is not fully resolved with this fix.  With a large enough account balance, the least significant bit of the significand will represent a quantity greater than 0.01, meaning that monetary quantities cannot be accurately recorded.  Drift can occur even without the exponent reaching this size.  **The recommended solution is to store account balances as integer cents.**  The possibility of integer overflow is noted, but since SQLite can hold integers larger than 9.2 quintillion, which as cents would represent over 92 quadrillion dollars, no such user currently exists on Earth.  Should one emerge, we can request that they open a second account or consider additional fixes.  As such, we disregard this issue for now and proceed with the recommended fix. 


To do this, we should update the `account` schema in `lib/db/schema.ts`.  Line 27 of the `account` schema is currently
```ts
balance: real("balance").default(0).notNull(),
```
to 
```ts
balance: integer("balance").default(0).notNull(),
```
We would need to do the same thing the the `amount` column for the `transactions` schema.   These changes will need to be mirrored in the table created SQL in `lib/db/index.ts`; for example, `balance REAL DEFAULT 0 NOT NULL,` should become `balance INTEGER DEFAULT 0 NOT NULL,`, and the corresponding change must also be made for the `transactions` table.

Moreover, the frontend will need to be modified so that the integer cent amounts are formatted in dollars as expected.  This is perhaps most easily done by stringifying the integer and inserting a decimal point two places from the right.

Finally, we need to migrate existing user accounts to the new schema.

### Ticket PERF-408: Resource Leak
**Priority:** Critical
**Status:** Fixed with "caveats" (see comments)

#### Root Cause
`lib/db/index.ts` begins with the lines 
```ts
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });

const connections: Database.Database[] = [];

export function initDb() {
  const conn = new Database(dbPath);
  connections.push(conn);

  // Create tables if they don't exist
  sqlite.exec(`
...
```

The array `connections` and the connection `conn` are neither exported nor used further.  Moreover, each time this module is imported, the connections `sqlite` and `conn` are created, leading to a potentially large accumulation of open connections.

#### Fix Implemented
I use the `globalThis` object to use the same connection between instances and delete `connections` and `conn`:

```ts
if (!globalThis._sqlite) {
  globalThis._sqlite = new Database(dbPath);
}
const sqlite = globalThis._sqlite;

export const db = drizzle(globalThis._sqlite, { schema });

export function initDb() {
  // Create tables if they don't exist
  sqlite.exec(`
...
```

In order to add the `sqlite` field to `globalThis` in TypeScript, I modified its type definition by creating a `global.d.ts` file with the contents:
```ts
import Database from "better-sqlite3";

declare global {
  var _sqlite: Database.Database | undefined;
}
```

#### Comments 
A single connection is not viable for a global banking platform.  But since SQLite is file-based and locks the database file when database operations are made, this issue is not resolved by creating more connections.  The architecture created in the fix is appropriate for SQLite, but SQLite is not appropriate for a global banking platform.  In order to scale the application, a more robust database allowing concurrency, such as PostgreSQL, is recommended.

#### Testing
The test in `tests/db.test.ts` ensures that the `Database()` constructor for the connection is called only once after several imports.