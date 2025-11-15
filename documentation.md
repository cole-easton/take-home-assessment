# SecureBank Bug Fix Documentation
**Author:** Cole Easton  
**Date:** 2025-11-15  

---

## Summary of Work
- Total issues investigated: X  
- Total issues fixed: X  
- Tests added: Yes/No  
- Prioritization strategy: Critical → High → Medium → UI  

---

## Detailed Issue Reports

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

- This solutions interprets the entered DOB as UTC and localizes to client time when getting the month, day, and year.  If the client is in a different time zome from the server, there may be disagreement between the front- and back-ends regarding whether the user has turned 18.  But since there is less than a 1-day discrepancy between times anywhere in the world, I beleive that my solution is compliant with US common law, as contrary to naive expectation, one becomes legally a year older at the first minute of the day *before* their birthday.  We should work with legal to make this more rigorous, implement state-specific and international laws, and assessment whether local time or server time is the source of truth regarding age.  This is potentially a sizeable project on its own.

### Ticket VAL-206: Card Number Validation
**Priority:** Critical  
**Status:** Fixed   

#### Root Cause
Only primitive checks were in place -- the system allowed exactly those cards whose card numbers were 16 digits long and that started with `4` or `5` in  in `components/FundingModal.tsx`.

#### Fix Implemented
I consulted [this table on Wikipedia](https://en.wikipedia.org/wiki/Payment_card_number#Issuer_identification_number_(IIN)) to allow support for the patterns of all major cards.  This entailed allowing a broader range of lengths (Amex card numbers are 15 numbers, for example) and validating the IIN numbers against the known issuing networks. Most networks validate card numbers using the [Luhn algorithm](https://en.wikipedia.org/wiki/Luhn_algorithm), so card we validate card numbers using this algorithm where appropriate.  Since LankaPay does not use the Luhn algorithm, we allow all 16-digit card numbers that begin with `357111`.  We note that Diners Club enRoute also does not have validation, but, since this card also does not have a provided IIN range, the best we could do to allow these cards is allow all 15-digit card numbers, which would undermine the value of this fix for American Express users.  It seems, however, that [this card has been largely phased out](https://www.flyertalk.com/forum/air-canada-aeroplan/12859-enroute-card-being-phased-out-sort.html) and replaced with Diners Club International, which is supported, so my assessment is that dropping support for Diners Club enRoute is an acceptable tradeoff for more rigorous checks on other 15-digit cards.

Since this is a user-experience issue, it is implemented on the frontend in `components/FundingModal.tsx`.  If users attempt to bypass this check using Postman or similar, they simply risk inconvieniencing themselves as the card my be rejected by the payment processor.

We note that these changes cannot guarantee that the card number was actually issued without making an API call to the issuing network, but this should be handled by the backend (not addressed in this fix because SecureBank is not a real bank).


### Ticket VAL-210: Card Type Detection
**Priority:** High
**Status:** Fixed

#### Root Cause
Only primitive checks were in place -- the system allowed exactly those cards whose card numbers were 16 digits long and that started with `4` or `5` in  in `components/FundingModal.tsx`.

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
Line 71 of `components/TransactionList.tsx` was changed to `<span>{transaction.description || "-"}</span>`{:.tsx} in commit `118516c` which treats the description as text and mitigates the potential for XSS attacks. 

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

This way, there is not a data correctnessness violation, and no data in guessed or inferred. The error handling is already handled correctly on the front-end; in `components/AccountCreationModal.tsx` it is handled by lines 21-26 as of the initial commit:

```tsx
    try {
      await createAccountMutation.mutateAsync({ accountType });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to create account");
    }
```