

/*
    Pathline filtering algorithm for time-dependent vector fields.

    The goal here is to create an animation of path-lines that emphasize the curvature 
    (or lack thereof) of the trajectories in a time-dependent vector field, while 
    avoiding visual clutter.

    The algorithm works as follows:
    Inputs: vector field v(x,t), time interval [0,1], number of path-lines N,
            time window size delta_t
    1. Sample a large number of path-lines from the vector field.
    2. For each path-line, compute a curvature score based on the average curvature

*/