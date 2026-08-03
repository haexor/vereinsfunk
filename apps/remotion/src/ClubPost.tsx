import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { z } from 'zod'

export const ClubPostPropsSchema = z.object({
  clubName: z.string().min(1).max(60),
  eyebrow: z.string().max(40),
  headline: z.string().min(1).max(80),
  detail: z.string().max(140),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  layoutFamily: z.enum(['photo_moment', 'training', 'quote', 'collage', 'invitation', 'thanks', 'result']).default('photo_moment'),
})

export type ClubPostProps = z.infer<typeof ClubPostPropsSchema>

export function ClubPost(props: ClubPostProps) {
  const safeProps = ClubPostPropsSchema.parse(props)
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ fps, frame, config: { damping: 14, stiffness: 90 } })
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill
      style={{
        backgroundColor: safeProps.primaryColor,
        color: '#fff',
        fontFamily: 'Arial, sans-serif',
        padding: 88,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 740,
          height: 740,
          right: -260,
          top: -210,
          borderRadius: '50%',
          background: safeProps.accentColor,
          transform: `scale(${0.8 + enter * 0.2})`,
        }}
      />
      <div style={{ position: 'relative', opacity, transform: `translateY(${(1 - enter) * 60}px)` }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase' }}>
          {safeProps.layoutFamily === 'training' && !props.eyebrow ? 'TRAININGSMOMENT' : safeProps.eyebrow}
        </div>
        <h1 style={{ fontSize: 104, lineHeight: 0.95, maxWidth: 840, margin: '180px 0 52px' }}>
          {safeProps.headline}
        </h1>
        <p style={{ fontSize: 38, lineHeight: 1.35, maxWidth: 760 }}>{safeProps.detail}</p>
      </div>
      <div style={{ position: 'absolute', left: 88, right: 88, bottom: 78, display: 'flex', justifyContent: 'space-between', fontSize: 28, fontWeight: 700 }}>
        <span>{safeProps.clubName}</span>
        <span>#gemeinsamstark</span>
      </div>
    </AbsoluteFill>
  )
}
