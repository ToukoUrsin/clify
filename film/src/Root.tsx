import React from 'react';
import {Composition} from 'remotion';
import {Main, SCENES, TOTAL, Teaser, TEASER_DUR} from './Main';
import {Primary, PRIMARY_DUR} from './Primary';
import {Submission, SUB_DUR, subDur} from './Submission';

export const Root: React.FC = () => (
	<>
		<Composition id="Submission" component={Submission} durationInFrames={SUB_DUR} fps={30} width={1920} height={1080} defaultProps={{audio: true, captions: true}} />
		<Composition id="SubmissionV11" component={Submission} durationInFrames={subDur('v11')} fps={30} width={1920} height={1080} defaultProps={{audio: true, captions: true, cut: 'v11' as const}} />
		<Composition id="SubmissionNoAudio" component={Submission} durationInFrames={SUB_DUR} fps={30} width={1920} height={1080} defaultProps={{audio: false, captions: true}} />
		<Composition id="Primary" component={Primary} durationInFrames={PRIMARY_DUR} fps={30} width={1920} height={1080} defaultProps={{music: true}} />
		<Composition id="PrimarySilent" component={Primary} durationInFrames={PRIMARY_DUR} fps={30} width={1920} height={1080} defaultProps={{music: false}} />
		<Composition id="Main" component={Main} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{}} />
		<Composition id="Teaser" component={Teaser} durationInFrames={TEASER_DUR} fps={30} width={1920} height={1080} defaultProps={{}} />
		<Composition id="MainVO" component={Main} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{audio: true}} />
		{SCENES.map((s) => (
			<Composition key={s.name} id={`S-${s.name}`} component={Main} durationInFrames={s.dur} fps={30} width={1920} height={1080} defaultProps={{only: s.name}} />
		))}
	</>
);
