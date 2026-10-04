export type Stats = {
  points: number;
  approvedReviews: number;
  activeDays: number;
  quality: number | null;
};
export type Requirements = {
  minimumPoints: number;
  minimumApprovedReviews: number;
  minimumActiveDays: number;
  minimumQuality: number | null;
};
export function eligibility(s: Stats, r: Requirements) {
  const checks = [
    { name: 'Points', actual: s.points, required: r.minimumPoints },
    {
      name: 'Approved reviews',
      actual: s.approvedReviews,
      required: r.minimumApprovedReviews,
    },
    {
      name: 'Active days',
      actual: s.activeDays,
      required: r.minimumActiveDays,
    },
    ...(r.minimumQuality === null
      ? []
      : [
          {
            name: 'Quality',
            actual: s.quality ?? -1,
            required: r.minimumQuality,
          },
        ]),
  ].map((c) => ({ ...c, met: c.actual >= c.required }));
  return { eligible: checks.every((c) => c.met), checks };
}
