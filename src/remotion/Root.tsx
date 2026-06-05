import React from 'react';
import { Composition } from 'remotion';
import { StudentProgressVideo } from './StudentProgressVideo';
import { defaultStudentProgressVideoProps } from '../types/studentProgressVideo';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="StudentProgressVideo"
    component={StudentProgressVideo}
    durationInFrames={1800}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={defaultStudentProgressVideoProps}
  />
);
