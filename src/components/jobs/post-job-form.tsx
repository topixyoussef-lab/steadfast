"use client";

import { useActionState } from "react";
import Link from "next/link";

import { postJobAction, type JobState } from "@/app/actions/jobs";
import { useI18n } from "@/components/i18n-provider";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { JobCategory } from "@/lib/types";

const JOB_TYPES = [
  { value: "micro", key: "formTypeMicro" },
  { value: "gig", key: "formTypeGig" },
  { value: "part_time", key: "formTypePartTime" },
  { value: "full_time", key: "formTypeFullTime" },
  { value: "internship", key: "formTypeInternship" },
] as const;

export function PostJobForm({ categories }: { categories: JobCategory[] }) {
  const { dict } = useI18n();
  const [state, formAction] = useActionState<JobState, FormData>(
    postJobAction,
    {},
  );

  if (state.ok) {
    return (
      <div
        role="status"
        className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent"
      >
        {dict.jobs.postedLive}
        <Link
          href="/jobs"
          className="mt-2 block text-sm font-medium underline underline-offset-2"
        >
          {dict.jobs.backToJobs}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field
        label={dict.jobs.formTitle}
        name="title"
        placeholder={dict.jobs.formTitlePlaceholder}
        required
        minLength={5}
        maxLength={120}
        errors={state.fieldErrors?.title}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium text-muted">
          {dict.jobs.formDescription}
        </label>
        <textarea
          id="description"
          name="description"
          rows={6}
          required
          minLength={20}
          maxLength={4000}
          placeholder={dict.jobs.formDescriptionPlaceholder}
          className="w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <FormError message={state.fieldErrors?.description?.[0]} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="price" className="text-sm font-medium text-muted">
            {dict.jobs.formPrice}
          </label>
          <input
            id="price"
            name="price"
            type="number"
            min={0}
            step="0.01"
            placeholder="25.00"
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <FormError message={state.fieldErrors?.price?.[0]} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="priceType" className="text-sm font-medium text-muted">
            {dict.jobs.formPriceType}
          </label>
          <select
            id="priceType"
            name="priceType"
            defaultValue="fixed"
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          >
            <option value="fixed">{dict.jobs.formPriceFixed}</option>
            <option value="hourly">{dict.jobs.formPriceHourly}</option>
            <option value="negotiable">{dict.jobs.formPriceNegotiable}</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="jobType" className="text-sm font-medium text-muted">
          {dict.jobs.formType}
        </label>
        <select
          id="jobType"
          name="jobType"
          defaultValue="micro"
          className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        >
          {JOB_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {dict.jobs[type.key]}
            </option>
          ))}
        </select>
        <FormError message={state.fieldErrors?.jobType?.[0]} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="categoryId" className="text-sm font-medium text-muted">
            {dict.jobs.formCategory}
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue=""
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          >
            <option value="" disabled>
              {dict.jobs.formCategoryChoose}
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <FormError message={state.fieldErrors?.categoryId?.[0]} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="estimatedHours" className="text-sm font-medium text-muted">
            {dict.jobs.formEstimatedHours}
          </label>
          <input
            id="estimatedHours"
            name="estimatedHours"
            type="number"
            min={0}
            step="0.5"
            placeholder="2"
            className="h-12 w-full rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <FormError message={state.fieldErrors?.estimatedHours?.[0]} />
        </div>
      </div>

      <FormError message={state.error} />
      <SubmitButton pendingLabel={dict.jobs.formPending}>
        {dict.jobs.formSubmit}
      </SubmitButton>
    </form>
  );
}