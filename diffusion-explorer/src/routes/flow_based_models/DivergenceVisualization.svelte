<!-- 
    Here the goal is to visualize the negative probability flux flowing out of a square region.
    1. Take a trained 2D flow based model. 
    2. Take a square region in space. 
    3. Sample a bunch of points in this region. 
    4. Run the reverse dynamics of these points in this region backward in time from t to 0. 
    5. Plot the forward trajectories of these points, they should flow into the square region. 

    Overall, plot trajectories moving into the square region. 

    The context of this visualization is this: 
    "
        The continuity equation tells us that the amount of probability mass flowing into a region is equal to the 
        change in probability mass in that region. 
    
        An important consequence of this is the conservation of probability mass, ensuring that as our 
        distribution is transformed by a flow, it remains a valid probability distribution (i.e. probability mass 1).
    "

    Ideas:
        - Visualize the integration of the square boundary. 
        - Visualize the trajectories of points moving into the square region.
        - Show in a separate graph below the density of the square region. 

    Video structure
        - Show small box, show flow into it, 
        - Grow the box to encompass the entire density. 
            - Show this in second tweet, or in long tweet, or just blog post. 

    Article:
    The continuity equation 
    \begin{equation}
        \frac{d}{dt} p_t(x) + div(p_t u_t)(x) = 0
    \end{equation}
    is an important constraint on our flow-based generative models. 
    This can is equivalent to 
    \begin{equation}
        \frac{d}{dt} p_t(x) = -div(p_t u_t)(x)
    \end{equation}
    Abstractly, this tells us that the change in probability density $\frac{d}{dt} p_t(x)$ at a 
    particular point $x$ and time $t$ is equal to the negative divergence of the flux $p_t u_t$ at that point. 
    Now, the left hand side is much more self explanatory than the right hand side. 
    First, the flux $p_t u_t$ is a vector field defined at each point $x$ that specifies
    the direction and magnitude of probability mass flowing through an infinitesimal region about $x$. 
    The divergence of a vector field measures the net outflow of the flux through an infinitesimal region. 

    ## Conservation of Probability

    One core consequence of the continuity equation is that the probability mass of our distribution 
    p_t(x) is preserved as it is transformed by the flow. 

    Stating this precisely, we want to ensure that for any $t$ we have that
    \begin{equation}
        \int p_t(x) dx = 1
    \end{equation}

    Let us assume that we have some standard probability distribution, like a multivariate Gaussian, 
    as our source distribution $p_0(x)$ which we know satisfies our equation $\int p_0(x) dx = 0$. 
    Now, we want to ensure that this is true for any arbitrary $t > 0$. 

    We can define
    \begin{equation}
        p_t(x) = p_0(x) + \int_0^t \frac{d}{dt} p_t(x) dt
    \end{equation}
    and we know by the continuity equation
    \begin{equation}
        p_0(x) + \int_0^t \frac{d}{dt} p_t(x) dt = p_0(x) - \int_0^t div(p_t u_t) dt 
    \end{equation}
    \begin{equation}
        \int_0^t \frac{d}{dt} p_t(x) dt = - \int_0^t div(p_t u_t) dt 
    \end{equation}
    Using the divergence theorem, we know that the integral of the divergence 
    over a region $\mathcal{D}$ is equal to the integral of the flux leaving the boundary of 
    $\mathcal{D}$.
    \begin{equation}
        \int_\mathcal{D} div(u)(x) dx = \int_{\delta\mathcal{D}} u(x) \cdot n(y) ds_y
    \end{equation}
    where $n(x)$ represents a vector orthogonal to the boundary of $\mathcal{D}$ at point $y$. 

    Why is this useful to us? Well, if we define a region $\mathcal{D}$ that is sufficiently large, 
    such that it encompasses the vast majority of our probability mass, we should conceptually realize
    that the amount of probability mass flowing out of $\mathcal{D}$ at any given point in time, should be zero. 

    Putting this all together we have that
    \begin{align}
        \int_\mathcal{D} p_t(x) dx &= \int_\mathcal{D}[p_0(x) + \int_0^t \frac{d}{dt} p_t(x) dt] dx \\ 
        &= \int p_0(x) dx + int_\mathcal{D}\int_0^t \frac{d}{dt} p_t(x) dt dx \\ 
        &= 1 + int_\mathcal{D} \int_0^t \frac{d}{dt} p_t(x) dt dx \\ 
        &= 1 + \int_0^t \int_\mathcal{D} \frac{d}{dt} p_t(x) dx dt \\ % swap integrals
        &= 1 + \int_0^t \int_\mathcal{D} - div(p_t u_t)(x) dx dt \\ % continuity equation
        &= 1 - \int_0^t \int_\mathcal{D} div(p_t u_t)(x) dx dt \\
        &= 1 - \int_0^t \int_\mathcal{D} p_t(y) u_t(y) \cdot n(y) ds_y dt \\ % divergence theorem
        &= 1 - \int_0^t 0 dt \\ % For large enough region
        &= 1  \\ 
    \end{align}

    \begin{equation}
    \end{equation}

    The continuity equation tells us that the amount of probability mass flowing into a region is equal to the 
        change in probability mass in that region. 
    
        An important consequence of this is the conservation of probability mass, ensuring that as our 
        distribution is transformed by a flow, it remains a valid probability distribution (i.e. probability mass 1).

  -->