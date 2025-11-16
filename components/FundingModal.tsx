"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { trpc } from "@/lib/trpc/client";

interface FundingModalProps {
  accountId: number;
  onClose: () => void;
  onSuccess: () => void;
}

type FundingFormData = {
  amount: string;
  fundingType: "card" | "bank";
  accountNumber: string;
  routingNumber?: string;
};

export function FundingModal({ accountId, onClose, onSuccess }: FundingModalProps) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FundingFormData>({
    defaultValues: {
      fundingType: "card",
    },
  });

  const fundingType = watch("fundingType");
  const utils = trpc.useUtils();
  const fundAccountMutation = trpc.account.fundAccount.useMutation({
    onSuccess: () => {
      utils.account.getTransactions.invalidate({ accountId });
      onSuccess();
    },
  });

  const onSubmit = async (data: FundingFormData) => {
    setError("");

    try {
      const amount = parseFloat(data.amount);

      await fundAccountMutation.mutateAsync({
        accountId,
        amount,
        fundingSource: {
          type: data.fundingType,
          accountNumber: data.accountNumber,
          routingNumber: data.routingNumber,
        },
      });

      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to fund account");
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Fund Your Account</h3>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <div className="mt-1 relative rounded-md shadow-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 sm:text-sm">$</span>
              </div>
              <input
                {...register("amount", {
                  required: "Amount is required",
                  pattern: {
                    value: /^\d+\.?\d{0,2}$/,
                    message: "Invalid amount format",
                  },
                  min: {
                    value: 0.0,
                    message: "Amount must be at least $0.01",
                  },
                  max: {
                    value: 10000,
                    message: "Amount cannot exceed $10,000",
                  },
                })}
                type="text"
                className="pl-7 block w-full rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm p-2 border"
                placeholder="0.00"
              />
            </div>
            {errors.amount && <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Funding Source</label>
            <div className="space-y-2">
              <label className="flex items-center">
                <input {...register("fundingType")} type="radio" value="card" className="mr-2" />
                <span>Credit/Debit Card</span>
              </label>
              <label className="flex items-center">
                <input {...register("fundingType")} type="radio" value="bank" className="mr-2" />
                <span>Bank Account</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              {fundingType === "card" ? "Card Number" : "Account Number"}
            </label>
            <input
              {...register("accountNumber", {
                required: `${fundingType === "card" ? "Card" : "Account"} number is required`,
                pattern: {
                  value: fundingType === "card" ? /^\d{13,19}$/ : /^\d+$/,
                  message: fundingType === "card" ? "Card number must be between 13 and 19 digits" : "Invalid account number",
                },
                validate: {
                  validCard: (value) => {
                    if (fundingType !== "card") return true;
                    let sum = 0;
                    const parity = value.length % 2;
                    for (let i = 0; i < value.length; i++) {
                      const cardNumber = parseInt(value[i]);
                      if (i % 2 !== parity) {
                        sum += cardNumber;
                      }
                      else if (cardNumber > 4) {
                        sum += 2 * cardNumber - 9;
                      }
                      else {
                        sum += 2 * cardNumber;
                      }
                    }
                    const LuhnPass = sum % 10 === 0;
                    const len = value.length;
                    return LuhnPass &&
                      (
                        //American Express
                        ((value.startsWith("34") || value.startsWith("37")) && len === 15) ||
                        // China T-Union
                        (value.startsWith("31") && len === 19) ||
                        // China UnionPay
                        (value.startsWith("62") && len >= 16 && len <= 19) ||
                        // Diners Club International
                        ((value.startsWith("30") || value.startsWith("36") || value.startsWith("38") || value.startsWith("39")) && len >= 14 && len <= 19) ||
                        // Discover Card
                        ((value.startsWith("6011") ||
                          (parseInt(value.substring(0, 3)) >= 644 && parseInt(value.substring(0, 3)) <= 649) ||
                          value.startsWith("65") ||
                          (parseInt(value.substring(0, 6)) >= 622126 && parseInt(value.substring(0, 6)) <= 622925)) &&
                          len >= 16 && len <= 19) ||
                        // Mastercard
                        (((parseInt(value.substring(0, 4)) >= 2221 && parseInt(value.substring(0, 4)) <= 2720) ||
                          (parseInt(value.substring(0, 2)) >= 51 && parseInt(value.substring(0, 2)) <= 55)) &&
                          len === 16) ||
                        // JCB
                        ((parseInt(value.substring(0, 4)) >= 3528 && parseInt(value.substring(0, 4)) <= 3589) && len >= 16 && len <= 19) ||
                        // Visa
                        (value.startsWith("4") && (len === 13 || len === 16 || len === 19)) ||
                        // Uzcard
                        ((value.startsWith("8600") || value.startsWith("5614")) && len === 16) ||
                        // GPN
                        ((value.startsWith("1946") || ["50", "56", "58"].includes(value.substring(0, 2)) || (parseInt(value.substring(0, 2)) >= 60 && parseInt(value.substring(0, 2)) <= 63)) && (len === 16 || len === 18 || len === 19))
                      )
                      // LankaPay (doesn't use Luhn's algorithm)
                      || (value.startsWith("357111") && len === 16)
                      || "Invalid card number";
                  },
                },
              })}
              type="text"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
              placeholder={fundingType === "card" ? "1234567812345678" : "123456789"}
            />
            {errors.accountNumber && <p className="mt-1 text-sm text-red-600">{errors.accountNumber.message}</p>}
          </div>

          {fundingType === "bank" && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Routing Number</label>
              <input
                {...register("routingNumber", {
                  required: "Routing number is required",
                  pattern: {
                    value: /^\d{9}$/,
                    message: "Routing number must be 9 digits",
                  },
                })}
                type="text"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border"
                placeholder="123456789"
              />
              {errors.routingNumber && <p className="mt-1 text-sm text-red-600">{errors.routingNumber.message}</p>}
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={fundAccountMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {fundAccountMutation.isPending ? "Processing..." : "Fund Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
