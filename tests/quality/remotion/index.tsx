/** @jsxImportSource react */
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { KineticType } from './KineticType';

const Root: React.FC = () => <Composition id="KineticType" component={KineticType} durationInFrames={195} fps={30} width={1920} height={1080} />;
registerRoot(Root);
